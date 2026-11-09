import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";
import type { Macro, MacroContextRequest, MacroPlan } from "./macros";
import type { ContextFile } from "./context";

export class MacroPicker extends FuzzySuggestModal<Macro> {
  constructor(
    app: App,
    private macros: Macro[],
    private isFolder: boolean,
    private run: (macro: Macro) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose an AI macro");
  }
  getItems() {
    return this.macros;
  }
  getItemText(macro: Macro) {
    return (
      macro.name +
      " · " +
      (this.isFolder
        ? "Selected folder"
        : macro.includeParent
          ? "Containing folder"
          : "Selected file")
    );
  }
  onChooseItem(macro: Macro) {
    this.run(macro);
  }
}

export class MacroReview extends Modal {
  private approved = false;
  constructor(
    app: App,
    private plan: MacroPlan,
    private files: ContextFile[],
    private resolve: (apply: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    const el = this.contentEl;
    el.createEl("h2", { text: "Review AI macro result" });
    el.createEl("p", { text: this.plan.summary });
    const before = new Map(this.files.map((file) => [file.path, file.text]));
    for (const edit of this.plan.edits) {
      const details = el.createEl("details");
      details.createEl("summary", {
        text: (edit.action === "create" ? "Create " : "Replace ") + edit.path,
      });
      if (edit.action === "replace") {
        details.createEl("h4", { text: "Current text" });
        details.createEl("pre", {
          text: before.get(edit.path),
          cls: "panopto-study-progress",
        });
      }
      details.createEl("h4", { text: "Proposed text" });
      details.createEl("pre", {
        text: edit.text,
        cls: "panopto-study-progress",
      });
    }
    const actions = new Setting(el);
    if (this.plan.edits.length)
      actions.addButton((button) =>
        button
          .setButtonText(`Apply ${this.plan.edits.length} edit(s)`)
          .setCta()
          .onClick(() => {
            this.approved = true;
            this.close();
          }),
      );
    actions.addButton((button) =>
      button
        .setButtonText(this.plan.edits.length ? "Discard" : "Close")
        .onClick(() => this.close()),
    );
  }

  onClose() {
    this.resolve(this.approved);
    this.contentEl.empty();
  }
}

export class MacroContextReview extends Modal {
  private selection: Set<string> | null = null;

  constructor(
    app: App,
    private requests: MacroContextRequest[],
    private providerDescription: string,
    private resolve: (approved: ReadonlySet<string> | null) => void,
  ) {
    super(app);
  }

  onOpen() {
    const el = this.contentEl;
    const approved = new Set<string>();
    el.createEl("h2", { text: "Macro requests more context" });
    el.createEl("p", {
      text:
        this.providerDescription +
        " Select what to share for this run. Additional context is read-only.",
    });
    let refresh = () => {};
    for (const request of this.requests) {
      new Setting(el)
        .setName(request.path)
        .setDesc(
          (request.kind === "folder" ? "Folder and subfolders. " : "File. ") +
            request.reason,
        )
        .addToggle((toggle) =>
          toggle.onChange((value) => {
            if (value) approved.add(request.path);
            else approved.delete(request.path);
            refresh();
          }),
        );
    }
    new Setting(el)
      .addButton((button) => {
        refresh = () =>
          button.setButtonText(
            approved.size
              ? "Share selected and continue"
              : "Continue without sharing",
          );
        refresh();
        button.setCta().onClick(() => {
          this.selection = approved;
          this.close();
        });
      })
      .addButton((button) =>
        button.setButtonText("Cancel macro").onClick(() => this.close()),
      );
  }

  onClose() {
    this.resolve(this.selection);
    this.contentEl.empty();
  }
}

export function renderMacroSettings(
  el: HTMLElement,
  macros: Macro[],
  save: () => Promise<void>,
  refresh: () => void,
) {
  el.createEl("h2", { text: "Macros" });
  el.createEl("p", {
    text: "Run saved prompts from the file or folder context menu. Folder scopes include subfolders. Review the files before sending them to the model and review the proposed changes before applying them.",
  });
  for (const macro of macros) {
    new Setting(el)
      .setName("Macro name")
      .addText((input) =>
        input.setValue(macro.name).onChange(async (value) => {
          macro.name = value;
          await save();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Remove").onClick(async () => {
          macros.splice(macros.indexOf(macro), 1);
          await save();
          refresh();
        }),
      );
    new Setting(el).setName("Custom prompt").addTextArea((input) =>
      input
        .setPlaceholder(
          "Describe the result and any files the macro should edit.",
        )
        .setValue(macro.prompt)
        .onChange(async (value) => {
          macro.prompt = value;
          await save();
        }),
    );
    new Setting(el)
      .setName("Context when launched on a file")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("file", "Selected file only")
          .addOption("parent", "Containing folder")
          .setValue(macro.includeParent ? "parent" : "file")
          .onChange(async (value) => {
            macro.includeParent = value === "parent";
            await save();
          }),
      );
  }
  new Setting(el).addButton((button) =>
    button.setButtonText("Add macro").onClick(async () => {
      macros.push({ name: "", prompt: "", includeParent: false });
      await save();
      refresh();
    }),
  );
}
