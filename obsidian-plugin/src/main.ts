import {
  App,
  FileSystemAdapter,
  FuzzySuggestModal,
  TFolder,
  TFile,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} from "obsidian";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { shell } from "electron";
import path from "node:path";
import { createHash } from "node:crypto";
import { archiveBridge, type ArchiveResult } from "./bridge";
import {
  evidenceFromText,
  generateStudy,
  chunks,
  validateStudy,
  renderStudy,
  type Evidence,
  type Study,
  safeText,
  type Chat,
} from "./study";
import { ollamaChat, type Usage } from "./model";
import { codexChat } from "./codex";
import { mergeTranscripts } from "./transcripts";
import {
  selectedSidebarFolder,
  destinationPath,
  createDestination,
} from "./destination";
import { exportLearningPage, referenceHelper } from "./learning-export";
import { contextScope, existingPath } from "./context";
import { folderReferences, folderSources } from "./folder-study";
import {
  macroSchema,
  planMacroTask,
  applyMacroPlan,
  type Macro,
} from "./macros";
import {
  MacroContextReview,
  MacroPicker,
  MacroReview,
  renderMacroSettings,
} from "./macro-ui";
interface Settings {
  python: string;
  notesFolder: string;
  sourceFolder: string;
  provider: "ollama" | "codex";
  endpoint: string;
  localModel: string;
  codexModel: string;
  codexPath: string;
  rememberLogin: boolean;
  sessionName: string;
  maxInputBytes: number;
  maxOutputTokens: number;
  ffmpeg: string;
  ffprobe: string;
  macros: Macro[];
}
const defaults: Settings = {
  python: "",
  notesFolder: "Panopto Study",
  sourceFolder: "Panopto Sources",
  provider: "codex",
  endpoint: "http://localhost:11434",
  localModel: "",
  codexModel: "",
  codexPath: "codex",
  rememberLogin: false,
  sessionName: "panopto-study",
  maxInputBytes: 80000,
  maxOutputTokens: 1800,
  ffmpeg: "",
  ffprobe: "",
  macros: [],
};
async function confined(base: string, file: string): Promise<string> {
  const root = await realpath(base),
    target = await realpath(file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Archive file is outside its source folder");
  return target;
}
function vaultFolder(value: string): string {
  const clean = normalizePath(value);
  if (
    !clean ||
    clean.startsWith("/") ||
    clean.split("/").some((p) => p === ".." || p.startsWith("."))
  )
    throw new Error("Choose a relative, non-hidden vault folder");
  return clean;
}
export default class PanoptoStudy extends Plugin {
  settings: Settings = { ...defaults };
  selectedFolderPath: string | null = null;
  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    const {
      apiModel: _oldModel,
      apiSecret: _oldSecret,
      ...clean
    } = (saved || {}) as Partial<Settings> & {
      apiModel?: string;
      apiSecret?: string;
    };
    this.settings = {
      ...defaults,
      ...clean,
      provider: clean.provider === "ollama" ? "ollama" : "codex",
      macros: Array.isArray(clean.macros)
        ? clean.macros.filter(
            (macro) =>
              macro &&
              typeof macro.name === "string" &&
              typeof macro.prompt === "string" &&
              typeof macro.includeParent === "boolean",
          )
        : [],
    };
    this.addSettingTab(new StudySettings(this.app, this));
    this.addCommand({
      id: "import-lecture",
      name: "Import lecture and create interactive study material",
      callback: () => this.openImport(),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Import Panopto lecture here")
              .setIcon("graduation-cap")
              .onClick(() => new ImportModal(this.app, this, file.path).open()),
          );
          menu.addItem((item) =>
            item
              .setTitle("Create learning page from folder")
              .setIcon("book-open")
              .onClick(() =>
                this.runContextAction(() =>
                  this.createFolderPage(file.path, file.name),
                ),
              ),
          );
        }
        const macros = this.settings.macros.filter(
          (macro) => macro.name.trim() && macro.prompt.trim(),
        );
        if (macros.length && (file instanceof TFolder || file instanceof TFile))
          menu.addItem((item) =>
            item
              .setTitle("AI macros…")
              .setIcon("sparkles")
              .onClick(() =>
                new MacroPicker(
                  this.app,
                  macros,
                  file instanceof TFolder,
                  (macro) =>
                    this.runContextAction(() =>
                      this.runMacro(file.path, file instanceof TFolder, macro),
                    ),
                ).open(),
              ),
          );
      }),
    );
    if (typeof document !== "undefined")
      this.registerDomEvent(
        document,
        "pointerdown",
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target?.closest('[data-type="file-explorer"]')) return;
          const folder = target.closest(".nav-folder-title[data-path]");
          if (folder) {
            const candidate = folder.getAttribute("data-path");
            this.selectedFolderPath =
              candidate !== null && this.app.vault.getFolderByPath(candidate)
                ? candidate
                : null;
          } else if (target.closest(".nav-file-title"))
            this.selectedFolderPath = null;
        },
        true,
      );
    this.addRibbonIcon("graduation-cap", "Import Panopto lecture", () =>
      this.openImport(),
    );
  }
  openImport() {
    const candidate =
      selectedSidebarFolder(
        typeof document === "undefined" ? undefined : document,
        (p) => !!this.app.vault.getFolderByPath(p),
      ) ?? this.selectedFolderPath;
    const selected =
      candidate !== null && this.app.vault.getFolderByPath(candidate)
        ? candidate
        : null;
    new ImportModal(this.app, this, selected).open();
  }
  async save() {
    await this.saveData(this.settings);
  }
  async writeNote(
    result: ArchiveResult,
    notify: (message: string) => void,
    approve: (text: string) => Promise<boolean>,
    cancelled: () => boolean = () => false,
    interactive = true,
    destination?: string,
    alsoMarkdown = false,
  ) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error("Desktop vault required");
    const root = path.join(
      adapter.getBasePath(),
      destination === undefined
        ? vaultFolder(this.settings.sourceFolder)
        : destinationPath(destination),
    );
    if (destination !== undefined) await confined(adapter.getBasePath(), root);
    const folder = await confined(root, result.folder);
    const entries: { text: string; source: string; panelSnapshot: boolean }[] =
      [];
    const warnings = new Set<string>();
    if (result.partial)
      warnings.add(
        "The source archive is partial. Some resources failed to export.",
      );
    for (const entry of result.transcripts) {
      const file = await confined(folder, entry.path);
      entries.push({
        text: await readFile(file, "utf8"),
        source: path.basename(file),
        panelSnapshot: entry.source === "semantic caption panel snapshot",
      });
      if (entry.warning) warnings.add(entry.warning);
    }
    const merged = mergeTranscripts(entries);
    const evidence = merged.evidence;
    if (!evidence.length)
      throw new Error(
        "No transcript was captured. Source files are kept; enable captions and retry.",
      );
    const model =
      this.settings.provider === "ollama"
        ? this.settings.localModel
        : this.settings.codexModel;
    if (this.settings.provider === "ollama" && !model)
      throw new Error("Set a local model name in plugin settings first");
    const totalBytes = merged.cleanBytes;
    if (totalBytes > this.settings.maxInputBytes)
      throw new Error(
        `Transcript is ${totalBytes} bytes; input limit is ${this.settings.maxInputBytes}. Raise the limit deliberately or select a shorter lecture.`,
      );
    const requestCount = chunks(
      evidence,
      this.settings.provider === "codex" ? this.settings.maxInputBytes : 10000,
    ).length;
    const info = `At most ${requestCount} generation requests before cache hits. Provider: ${this.settings.provider}. Model: ${model || "Codex default"}. Cleaned source: ${totalBytes} UTF-8 bytes in ${evidence.length} excerpts. ${this.settings.provider === "codex" ? "Transcript excerpts will be processed through your signed-in Codex CLI. Account usage limits apply; this integration cannot impose a hard output-token or spending cap. No API key is used." : `Text goes to the loopback model only. Output cap: ${this.settings.maxOutputTokens} tokens per request.`}`;
    if (!(await approve(info))) return;
    const usage: Usage[] = [];
    const chat = this.modelChat(usage, cancelled);
    // Cache is vault-local generated content only. No keys, cookies or source URLs are cached.
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          version: interactive ? 6 : 3,
          provider: this.settings.provider,
          model,
          cap:
            this.settings.provider === "ollama"
              ? this.settings.maxOutputTokens
              : undefined,
          evidence,
        }),
      )
      .digest("hex");
    const notes =
      destination === undefined
        ? vaultFolder(this.settings.notesFolder)
        : path
            .relative(adapter.getBasePath(), folder)
            .split(path.sep)
            .join("/");
    await this.ensureFolder(notes);
    const cacheFolder = normalizePath(`${notes}/Generated Cache`);
    await this.ensureFolder(cacheFolder);
    const cacheFile = normalizePath(`${cacheFolder}/${cacheKey}.json`);
    let studies: Study[];
    if (await this.app.vault.adapter.exists(cacheFile)) {
      const cached = JSON.parse(
        await this.app.vault.adapter.read(cacheFile),
      ) as { studies: Study[] };
      studies = cached.studies.map((study) =>
        validateStudy(
          JSON.stringify(study),
          new Set(evidence.map((e) => e.id)),
          interactive,
        ),
      );
      notify("Using unchanged lecture cache — no model call.");
    } else {
      studies = await generateStudy(
        evidence,
        chat,
        notify,
        {
          get: async (input) => {
            const key = createHash("sha256")
              .update(
                JSON.stringify({
                  v: 3,
                  provider: this.settings.provider,
                  model,
                  cap:
                    this.settings.provider === "ollama"
                      ? this.settings.maxOutputTokens
                      : undefined,
                  input,
                }),
              )
              .digest("hex");
            const file = normalizePath(`${cacheFolder}/chunk-${key}.json`);
            return (await this.app.vault.adapter.exists(file))
              ? await this.app.vault.adapter.read(file)
              : undefined;
          },
          set: async (input, value) => {
            const key = createHash("sha256")
              .update(
                JSON.stringify({
                  v: 3,
                  provider: this.settings.provider,
                  model,
                  cap:
                    this.settings.provider === "ollama"
                      ? this.settings.maxOutputTokens
                      : undefined,
                  input,
                }),
              )
              .digest("hex");
            await this.app.vault.adapter.write(
              normalizePath(`${cacheFolder}/chunk-${key}.json`),
              value,
            );
          },
        },
        this.settings.provider === "codex"
          ? this.settings.maxInputBytes
          : 10000,
        interactive,
      );
      await this.app.vault.adapter.write(
        cacheFile,
        JSON.stringify({ studies }),
      );
    }
    if (cancelled()) throw new Error("Generation cancelled");
    const note = renderStudy(result.title, studies, evidence, [...warnings]);
    let interactiveSection = "";
    if (interactive) {
      notify("Building interactive page with original lecture references…");
      const page = await exportLearningPage(
        {
          folder,
          title: result.title,
          studies,
          evidence,
          warnings: [...warnings],
          ffmpeg: this.settings.ffmpeg,
          ffprobe: this.settings.ffprobe,
        },
        referenceHelper(this.settings.python),
      );
      if (cancelled()) throw new Error("Generation cancelled");
      await writeFile(
        page.replace(/\.html$/, ".usage.json"),
        JSON.stringify(
          {
            provider: this.settings.provider,
            model: model || "Codex default",
            usage,
            fromCache: usage.length === 0,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      let openError = false;
      try {
        openError = !!(await shell.openPath(page));
      } catch {
        openError = true;
      }
      notify(
        openError
          ? `Interactive HTML saved: ${page}. Open it in your browser; automatic opening failed.`
          : `Interactive HTML saved and opened: ${page}`,
      );
      if (!alsoMarkdown) return;
      const relative = path
        .relative(path.join(adapter.getBasePath(), notes), page)
        .split(path.sep)
        .join("/");
      interactiveSection = `\n\n## Interactive learning\n\n[Open the lecture learning page](${encodeURI(relative).replace(/[()]/g, (c) => encodeURIComponent(c))})\n\nOriginal recordings and caption evidence are referenced directly. Visual content and feed alignment require review. Open the HTML in a browser; keep it with its source archive.\n`;
    }
    const mediaLinks: string[] = [];
    try {
      const manifest = JSON.parse(
        await readFile(
          await confined(folder, path.join(folder, "metadata/resources.json")),
          "utf8",
        ),
      ) as { resources: { files: string[] }[] };
      for (const resource of manifest.resources)
        for (const relative of resource.files) {
          if (!/\.(mp4|webm|m4a|mp3|ts)$/i.test(relative)) continue;
          const media = await confined(folder, path.join(folder, relative));
          const vaultRelative = path
            .relative(adapter.getBasePath(), media)
            .split(path.sep)
            .join("/");
          const link = encodeURI(
            path.posix.relative(notes, vaultRelative),
          ).replace(/[()]/g, (char) => encodeURIComponent(char));
          mediaLinks.push(`- [${safeText(path.basename(relative))}](${link})`);
        }
    } catch {
      /* Legacy archives may not have a resource manifest. */
    }
    const mediaSection = mediaLinks.length
      ? "\n\n## Original media\n\n" + mediaLinks.join("\n")
      : "";
    const base =
      result.title.replace(/[<>:"/\\|?*\x00-\x1f#\[\]]/g, "_").slice(0, 100) ||
      "Lecture";
    let target = normalizePath(`${notes}/${base}.md`);
    for (let n = 2; await this.app.vault.adapter.exists(target); n++)
      target = normalizePath(`${notes}/${base} (${n}).md`);
    const usageText = usage.length
      ? `\n\n## Model usage\n\n${usage.map((u) => `- Input: ${u.input}; cached input: ${u.cached}; output: ${u.output} tokens.`).join("\n")}`
      : "";
    const file = await this.app.vault.create(
      target,
      note + interactiveSection + mediaSection + usageText,
    );
    await this.app.workspace.getLeaf(false).openFile(file);
    notify(
      interactive
        ? "Study note and interactive HTML created. Open the learning-page link in your browser."
        : "Study note created. Verify generated claims and examples against the source excerpts.",
    );
  }
  private get modelName() {
    const model =
      this.settings.provider === "ollama"
        ? this.settings.localModel
        : this.settings.codexModel;
    if (this.settings.provider === "ollama" && !model.trim())
      throw new Error("Set a local model name in plugin settings first");
    return model;
  }

  private modelChat(
    usage: Usage[] = [],
    cancelled = () => false,
    schemaFor?: (user: string) => Record<string, unknown>,
  ): Chat {
    const model = this.modelName;
    const request = async (
      url: string,
      body: object,
      headers: Record<string, string> = {},
    ) => {
      if (cancelled()) throw new Error("Generation cancelled");
      try {
        const response = await requestUrl({
          url,
          method: "POST",
          contentType: "application/json",
          headers,
          body: JSON.stringify(body),
          throw: false,
        });
        if (cancelled()) throw new Error("Generation cancelled");
        if (response.status < 200 || response.status >= 300) throw new Error();
        return response.json as unknown;
      } catch {
        throw new Error(
          "Model request failed. Check the local service, model and limits. No automatic retry was made.",
        );
      }
    };
    return this.settings.provider === "ollama"
      ? ollamaChat(
          this.settings.endpoint,
          model,
          (url, body) => request(url, body),
          this.settings.maxOutputTokens,
          (u) =>
            usage.push({
              input: u.input,
              cached: u.cached,
              output: u.output,
            }),
          schemaFor,
        )
      : codexChat(
          this.settings.codexPath,
          model,
          (u) => usage.push(u),
          undefined,
          schemaFor,
        );
  }

  private async runContextAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "The requested action failed.",
        9000,
      );
    }
  }

  private async contextRoot() {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error("Desktop vault required");
    return { adapter, root: await realpath(adapter.getBasePath()) };
  }

  private get providerDescription() {
    return this.settings.provider === "codex"
      ? "These files will be sent to your signed-in Codex account."
      : "These files will be sent to your local Ollama model.";
  }

  async createFolderPage(folder: string, name: string) {
    const { root } = await this.contextRoot();
    const selected = contextScope(folder, true, false).folder;
    const directory = await existingPath(root, selected);
    const sources = await folderSources(
      root,
      selected,
      this.settings.maxInputBytes,
    );
    if (!sources.evidence.length)
      throw new Error(
        "This folder has no readable Markdown notes or archived captions.",
      );
    const chat = this.modelChat();
    if (
      !(await new Promise<boolean>((resolve) =>
        new ConfirmModal(
          this.app,
          this.providerDescription +
            " The worksheet is saved in this folder under learning.",
          resolve,
          sources.inputs,
        ).open(),
      ))
    )
      return;
    const studies = await generateStudy(
      sources.evidence,
      chat,
      (message) => {
        new Notice(message);
      },
      undefined,
      this.settings.provider === "codex" ? this.settings.maxInputBytes : 10000,
      true,
      true,
    );
    await existingPath(root, selected);
    const page = await exportLearningPage(
      {
        folder: directory,
        title: name || "Vault study worksheet",
        evidence: sources.evidence,
        studies,
        warnings: sources.warnings,
        ffmpeg: this.settings.ffmpeg,
        ffprobe: this.settings.ffprobe,
      },
      folderReferences(
        sources.archives,
        selected,
        referenceHelper(this.settings.python),
      ),
    );
    const error = await shell.openPath(page).catch(() => "Failed to open");
    new Notice(
      error
        ? "Worksheet saved. Open " + page
        : "Interactive worksheet saved and opened.",
    );
  }

  async runMacro(selected: string, isFolder: boolean, macro: Macro) {
    const { root, adapter } = await this.contextRoot();
    const scope = contextScope(selected, isFolder, macro.includeParent);
    const chat = this.modelChat([], undefined, macroSchema);
    const providerDescription = this.providerDescription;
    if (
      !(await new Promise<boolean>((resolve) =>
        new ConfirmModal(
          this.app,
          providerDescription +
            " Macro: " +
            macro.name +
            ". Scope: " +
            (scope.file || scope.folder || "Vault root") +
            ". The macro starts with paths and reads individual files as needed.",
          resolve,
          [],
          "Run macro",
        ).open(),
      ))
    )
      return;
    new Notice("Running AI macro…");
    const result = await planMacroTask({
      root,
      scope,
      selection: { path: selected, type: isFolder ? "folder" : "file" },
      prompt: macro.prompt,
      limit: this.settings.maxInputBytes,
      chat,
      approve: (requests) =>
        new Promise((resolve) =>
          new MacroContextReview(
            this.app,
            requests,
            providerDescription,
            resolve,
          ).open(),
        ),
    });
    if (!result) return;
    const { plan, files } = result;
    const apply = await new Promise<boolean>((resolve) =>
      new MacroReview(this.app, plan, files, resolve).open(),
    );
    if (!apply) return;
    const count = await applyMacroPlan(
      root,
      plan,
      files,
      async (relative, update) => {
        const file = this.app.vault.getFileByPath(relative);
        return file
          ? this.app.vault.process(file, (text) => {
              if (file.path !== relative)
                throw new Error("The selected file moved after review.");
              return update(text);
            })
          : adapter.process(relative, update);
      },
    );
    new Notice(`Applied ${count} macro edit${count === 1 ? "" : "s"}.`);
  }
  async ensureFolder(folder: string) {
    let current = "";
    for (const part of folder.split("/")) {
      current = normalizePath(`${current ? current + "/" : ""}${part}`);
      if (!(await this.app.vault.adapter.exists(current)))
        await this.app.vault.createFolder(current);
    }
  }
}
type DestinationChoice = { folder: TFolder } | { create: true };
class DestinationPicker extends FuzzySuggestModal<DestinationChoice> {
  constructor(
    app: App,
    private choose: (folder: TFolder) => void,
    private allowCreate = true,
  ) {
    super(app);
    this.setPlaceholder("Choose the folder for this lecture");
  }
  getItems(): DestinationChoice[] {
    return [
      ...(this.allowCreate ? [{ create: true as const }] : []),
      ...this.app.vault.getAllFolders(true).map((folder) => ({ folder })),
    ];
  }
  getItemText(item: DestinationChoice) {
    return "create" in item
      ? "＋ Create new folder…"
      : item.folder.path || "Vault root";
  }
  onChooseItem(item: DestinationChoice) {
    if ("create" in item) {
      this.close();
      new NewDestinationModal(this.app, this.choose).open();
    } else this.choose(item.folder);
  }
}
class NewDestinationModal extends Modal {
  constructor(
    app: App,
    private choose: (folder: TFolder) => void,
  ) {
    super(app);
  }
  onOpen() {
    const el = this.contentEl;
    el.createEl("h2", { text: "Create lecture folder" });
    let parent = "",
      name = "";
    const parentSetting = new Setting(el)
      .setName("Parent folder")
      .setDesc("Vault root");
    parentSetting.addButton((button) =>
      button.setButtonText("Choose parent").onClick(() =>
        new DestinationPicker(
          this.app,
          (folder) => {
            parent = folder.path;
            parentSetting.setDesc(parent || "Vault root");
          },
          false,
        ).open(),
      ),
    );
    new Setting(el)
      .setName("Folder name")
      .addText((text) =>
        text
          .setPlaceholder("New lecture folder")
          .onChange((value) => (name = value)),
      );
    const feedback = el.createDiv();
    feedback.setAttribute("role", "status");
    new Setting(el)
      .addButton((button) =>
        button
          .setButtonText("Create and use folder")
          .setCta()
          .onClick(() => {
            button.setDisabled(true);
            void (async () => {
              try {
                const adapter = this.app.vault.adapter;
                if (!(adapter instanceof FileSystemAdapter))
                  throw new Error("Desktop vault required");
                await confined(
                  adapter.getBasePath(),
                  path.join(adapter.getBasePath(), destinationPath(parent)),
                );
                const folder = await createDestination(
                  this.app.vault,
                  parent,
                  name,
                );
                this.choose(folder);
                this.close();
              } catch (error) {
                feedback.setText(
                  error instanceof Error
                    ? error.message
                    : "Could not create folder",
                );
                button.setDisabled(false);
              }
            })();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close()),
      );
  }
}
class ConfirmModal extends Modal {
  constructor(
    app: App,
    private text: string,
    private resolve: (value: boolean) => void,
    private files: string[] = [],
    private action = "Generate study material",
  ) {
    super(app);
  }
  answered = false;
  onOpen() {
    this.contentEl.createEl("h3", { text: "Review model request" });
    this.contentEl.createEl("p", { text: this.text });
    if (this.files.length) {
      const details = this.contentEl.createEl("details");
      details.createEl("summary", {
        text: `${this.files.length} source file(s)`,
      });
      const list = details.createEl("ul");
      for (const file of this.files) list.createEl("li", { text: file });
    }
    new Setting(this.contentEl)
      .addButton((b) =>
        b
          .setButtonText(this.action)
          .setCta()
          .onClick(() => {
            this.answered = true;
            this.resolve(true);
            this.close();
          }),
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    if (!this.answered) this.resolve(false);
  }
}
class ImportModal extends Modal {
  constructor(
    app: App,
    private plugin: PanoptoStudy,
    private destination: string | null = null,
  ) {
    super(app);
  }
  job: ReturnType<typeof archiveBridge> | undefined;
  running = false;
  cancelled = false;
  onOpen() {
    const el = this.contentEl;
    el.createEl("h2", { text: "Import Panopto lecture" });
    const destinationSetting = new Setting(el).setName("Save lecture in");
    const describeDestination = () =>
      destinationSetting.setDesc(
        this.destination === null
          ? "No sidebar folder identified. Choose a folder before importing."
          : `${this.destination || "Vault root"} / <lecture title> — recordings, captions, study note and learning HTML stay together.`,
      );
    describeDestination();
    destinationSetting.addButton((button) =>
      button.setButtonText("Choose folder").onClick(() =>
        new DestinationPicker(this.app, (folder) => {
          this.destination = folder.path;
          describeDestination();
        }).open(),
      ),
    );
    let url = "";
    let playback = false;
    let interactive = true;
    let alsoMarkdown = false;
    let includeMedia = true;
    new Setting(el)
      .setName("Lecture URL")
      .addText((t) =>
        t
          .setPlaceholder("https://…/Panopto/Pages/Viewer.aspx?id=…")
          .onChange((v) => (url = v)),
      );
    new Setting(el)
      .setName("Find playback streams")
      .setDesc(
        "Include playback media and captions only where you have permission to export.",
      )
      .addToggle((t) => t.onChange((v) => (playback = v)));
    new Setting(el)
      .setName("Download videos and attachments too")
      .setDesc(
        "Off: capture captions for study notes only. Avoids downloading large recordings again.",
      )
      .addToggle((toggle) =>
        toggle.setValue(true).onChange((value) => (includeMedia = value)),
      );
    new Setting(el)
      .setName("Output format")
      .setDesc(
        "HTML includes JavaScript/CSS interactions and opens in your browser. Markdown is a static note.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("html", "Interactive HTML (recommended)")
          .addOption("markdown", "Markdown note only")
          .setValue("html")
          .onChange((value) => (interactive = value === "html")),
      );
    new Setting(el)
      .setName("Also save a Markdown companion")
      .setDesc("Optional. HTML remains the primary output.")
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => (alsoMarkdown = value)),
      );
    const progress = el.createDiv({
      cls: "panopto-study-progress",
      text: "Ready. Browser sign-in stays local.",
    });
    const update = (message: string) => progress.setText(message);
    new Setting(el).addButton((b) =>
      b
        .setButtonText("Import lecture")
        .setCta()
        .onClick(() => {
          if (this.running) return;
          void (async () => {
            try {
              if (this.destination === null) {
                new DestinationPicker(this.app, (folder) => {
                  this.destination = folder.path;
                  describeDestination();
                  update(
                    "Destination selected. Click Import lecture to continue.",
                  );
                }).open();
                return;
              }
              const destination = destinationPath(this.destination);
              if (
                destination !== "" &&
                !this.app.vault.getFolderByPath(destination)
              )
                throw new Error(
                  "The selected folder no longer exists. Choose a folder and retry.",
                );
              const parsed = new URL(url);
              if (
                parsed.protocol !== "https:" ||
                !/^\/Panopto\/Pages\/(Viewer|Embed)\.aspx$/i.test(
                  parsed.pathname,
                ) ||
                !parsed.searchParams.get("id") ||
                parsed.username ||
                parsed.password
              )
                throw new Error(
                  "Enter a direct HTTPS Panopto Viewer/Embed URL",
                );
              if (!this.plugin.settings.python)
                throw new Error(
                  "Configure the v2 Python executable in settings",
                );
              const adapter = this.app.vault.adapter;
              if (!(adapter instanceof FileSystemAdapter))
                throw new Error("Desktop vault required");
              await confined(
                adapter.getBasePath(),
                path.join(adapter.getBasePath(), destination),
              );
              this.running = true;
              b.setDisabled(true);
              this.job = archiveBridge(
                this.plugin.settings.python,
                {
                  op: "archive",
                  autoPrepare: true,
                  url,
                  output: path.join(adapter.getBasePath(), destination),
                  includePlayback: playback,
                  kinds: includeMedia ? undefined : ["captions"],
                  rememberLogin: this.plugin.settings.rememberLogin,
                  sessionName: this.plugin.settings.sessionName,
                },
                (event) => {
                  if (event.type === "login") {
                    update(event.message);
                  } else if (
                    event.type === "progress" ||
                    event.type === "error"
                  )
                    update(event.message);
                },
              );
              const result = await this.job.done;
              await this.plugin.writeNote(
                result,
                update,
                (text) =>
                  new Promise((resolve) =>
                    new ConfirmModal(this.app, text, resolve).open(),
                  ),
                () => this.cancelled,
                interactive,
                destination,
                alsoMarkdown,
              );
            } catch (error) {
              update(error instanceof Error ? error.message : "Import failed");
            } finally {
              this.running = false;
              b.setDisabled(false);
              this.job = undefined;
            }
          })();
        }),
    );
    new Setting(el).setName("Saved login").addButton((button) =>
      button
        .setButtonText("Forget saved login for entered site")
        .onClick(() => {
          if (this.running) return;
          void (async () => {
            try {
              const u = new URL(url);
              if (u.protocol !== "https:" || u.username || u.password)
                throw new Error("Enter the lecture URL first");
              const task = archiveBridge(
                this.plugin.settings.python,
                {
                  op: "forget",
                  url,
                  sessionName: this.plugin.settings.sessionName,
                },
                () => {},
              );
              await task.done;
              update(
                "Saved local login for this site was removed. Your university password was not changed.",
              );
            } catch {
              update(
                "Could not remove saved login. Check the entered URL and keychain access.",
              );
            }
          })();
        }),
    );
    el.createEl("p", {
      text: "Closing this window cancels an active import. Saved login uses the OS keychain only when enabled in settings.",
    });
  }
  onClose() {
    this.cancelled = true;
    this.job?.cancel();
  }
}
class StudySettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: PanoptoStudy,
  ) {
    super(app, plugin);
  }
  display() {
    const el = this.containerEl;
    el.empty();
    for (const [key, label] of [
      ["ffmpeg", "FFmpeg executable"],
      ["ffprobe", "FFprobe executable"],
    ] as const)
      new Setting(el)
        .setName(label)
        .setDesc(
          "Optional absolute path for local reference frames. Leave blank to use PATH; original videos still work without frames.",
        )
        .addText((text) =>
          text.setValue(this.plugin.settings[key]).onChange(async (value) => {
            this.plugin.settings[key] = value.trim();
            await this.plugin.save();
          }),
        );
    el.createEl("h2", { text: "Panopto Study" });
    const s = this.plugin.settings;
    const text = (
      name: string,
      key:
        | "python"
        | "notesFolder"
        | "sourceFolder"
        | "endpoint"
        | "localModel"
        | "codexModel"
        | "codexPath",
      desc: string,
    ) =>
      new Setting(el)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(s[key]).onChange(async (v) => {
            s[key] = v;
            await this.plugin.save();
          }),
        );
    text(
      "Python executable",
      "python",
      "Absolute path to v2/.venv/bin/python. Install the v2 package and Chromium first.",
    );
    text(
      "Study notes folder",
      "notesFolder",
      "Vault-relative destination; existing notes are never overwritten.",
    );
    text(
      "Source archive folder",
      "sourceFolder",
      "Local archive within the vault; videos can be large.",
    );
    new Setting(el)
      .setName("Remember university login")
      .setDesc(
        "Opt in to storing authenticated browser state in the OS keychain. Passwords/MFA stay in the browser; sessions can expire. No plaintext fallback.",
      )
      .addToggle((t) =>
        t.setValue(s.rememberLogin).onChange(async (v) => {
          s.rememberLogin = v;
          await this.plugin.save();
        }),
      );
    new Setting(el).setName("Model provider").addDropdown((d) =>
      d
        .addOption("ollama", "Local Ollama")
        .addOption("codex", "Codex (ChatGPT sign-in)")
        .setValue(s.provider)
        .onChange(async (v) => {
          s.provider = v === "codex" ? "codex" : "ollama";
          await this.plugin.save();
        }),
    );
    text(
      "Ollama endpoint",
      "endpoint",
      "Loopback only; for example http://localhost:11434.",
    );
    text(
      "Local model",
      "localModel",
      "Name of an already installed Ollama model.",
    );
    text(
      "Codex executable",
      "codexPath",
      "Absolute path is recommended on macOS; sign in using codex login first.",
    );
    text(
      "Codex model (optional)",
      "codexModel",
      "Leave empty for the Codex CLI default. Uses ChatGPT sign-in, not an API key.",
    );
    new Setting(el)
      .setName("Maximum AI context bytes")
      .setDesc(
        "Limit for lecture captions, folder sources and macro context. Actual token usage depends on the model.",
      )
      .addText((t) =>
        t.setValue(String(s.maxInputBytes)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 1000 && n <= 1000000) {
            s.maxInputBytes = n;
            await this.plugin.save();
          }
        }),
      );
    new Setting(el).setName("Local Ollama output token cap").addText((t) =>
      t.setValue(String(s.maxOutputTokens)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 300 && n <= 8000) {
          s.maxOutputTokens = n;
          await this.plugin.save();
        }
      }),
    );
    renderMacroSettings(
      el,
      s.macros,
      () => this.plugin.save(),
      () => this.display(),
    );
  }
}
