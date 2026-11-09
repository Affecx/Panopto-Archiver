import { it, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  readdir,
  rm,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("electron", () => ({
  shell: { openPath: vi.fn().mockResolvedValue("") },
}));
vi.mock("obsidian", () => ({
  Plugin: class {
    app: unknown;
    constructor(app: unknown) {
      this.app = app;
    }
  },
  PluginSettingTab: class {},
  Modal: class {},
  FuzzySuggestModal: class {},
  TFolder: class {},
  Notice: class {},
  SecretComponent: class {},
  Setting: class {},
  FileSystemAdapter: class {
    constructor(public base: string) {}
    getBasePath() {
      return this.base;
    }
    async exists(file: string) {
      try {
        await access(path.join(this.base, file));
        return true;
      } catch {
        return false;
      }
    }
    async read(file: string) {
      return readFile(path.join(this.base, file), "utf8");
    }
    async write(file: string, data: string) {
      await writeFile(path.join(this.base, file), data);
    }
  },
  normalizePath: (value: string) =>
    value.replace(/\\/g, "/").replace(/^\/+/, ""),
  requestUrl: vi.fn(),
}));
import PanoptoStudy from "../src/main";
import { shell } from "electron";
import * as learningExports from "../src/learning-export";
import { FileSystemAdapter, requestUrl, type App } from "obsidian";
const study = {
  lessons: [
    {
      title: "AND gate",
      explanation: "An AND gate outputs 1 when both input bits are 1.",
      walkthrough: "A = 1, B = 0. B is not 1, so the output is 0.",
      misconception: "One input being 1 is insufficient.",
      question: "What does AND output for A = 0 and B = 0?",
      answer: "0, because neither input is 1.",
      evidence: ["E1"],
      practice: {
        goal: "Predict the result of a two-input AND.",
        setup: "A and B are single bits.",
        hint: "Count how many input bits are 1.",
        recallQuestion: "When does AND output 1?",
        recallAnswer: "Only when both input bits are 1.",
      },
    },
  ],
  summary: "AND requires two true inputs.",
  takeaways: [
    { text: "The output is 1 only for inputs 1,1.", evidence: ["E1"] },
  ],
  examples: [
    {
      title: "AND example",
      problem: "Find 1 AND 0.",
      steps: ["Read both inputs.", "Apply AND: not both are true."],
      answer: "0",
      check: "The truth table confirms 0.",
      evidence: ["E1"],
    },
  ],
  questions: ["When does AND return 1?"],
};
it("creates actual notes, cites sources, keeps keys out of files and avoids a second model request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "panopto-vault-"));
  try {
    const folder = path.join(root, "Panopto Sources", "Lecture");
    await mkdir(folder, { recursive: true });
    const transcript = path.join(folder, "captions.txt");
    await writeFile(transcript, "Both inputs must be true.\n0:07");
    const adapter = new FileSystemAdapter();
    (adapter as unknown as { base: string }).base = root;
    const app = {
      vault: {
        adapter,
        createFolder: async (p: string) => mkdir(path.join(root, p)),
        create: async (p: string, data: string) => {
          await writeFile(path.join(root, p), data);
          return { path: p };
        },
      },
      workspace: { getLeaf: () => ({ openFile: vi.fn() }) },
      secretStorage: { getSecret: () => "fake-test-key" },
    } as unknown as App;
    const plugin = new PanoptoStudy(app, { id: "panopto-study" } as never);
    plugin.settings = {
      ...plugin.settings,
      provider: "ollama",
      localModel: "test-model",
    };
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      json: { message: { content: JSON.stringify(study) } },
    } as never);
    const result = {
      type: "result" as const,
      folder,
      title: "Lecture",
      partial: false,
      transcripts: [
        { path: transcript, warning: "Snapshot may be incomplete." },
      ],
    };
    const prepare = vi
      .spyOn(learningExports, "referenceHelper")
      .mockReturnValue(async () => ({
        version: 1,
        feeds: [],
        frames: [],
        warnings: ["No video in this fictional archive"],
        sampling: "Fictional source",
      }));
    await plugin.writeNote(
      result,
      () => {},
      async () => true,
      () => false,
      true,
      undefined,
      true,
    );
    expect(
      await readFile(path.join(folder, "learning/index.html"), "utf8"),
    ).toContain("Both inputs must be true.");
    await plugin.writeNote(
      result,
      () => {},
      async () => true,
      () => false,
      true,
      undefined,
      true,
    );
    prepare.mockRestore();
    expect(requestUrl).toHaveBeenCalledTimes(1);
    const note = await readFile(
      path.join(root, "Panopto Study", "Lecture.md"),
      "utf8",
    );
    expect(note).toContain("[[#^E1|E1]]");
    expect(note).toContain("Open the lecture learning page");
    expect(note).toContain("Snapshot may be incomplete");
    expect(note).not.toContain("fake-test-key");
    expect(await readdir(path.join(root, "Panopto Study"))).toContain(
      "Lecture (2).md",
    );
    for (const file of await readdir(
      path.join(root, "Panopto Study", "Generated Cache"),
    )) {
      expect(
        await readFile(
          path.join(root, "Panopto Study", "Generated Cache", file),
          "utf8",
        ),
      ).not.toContain("fake-test-key");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("keeps lecture media, generated note and cache together under the chosen sidebar destination", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "panopto-selected-folder-"),
  );
  try {
    const folder = path.join(root, "Course/Topic/Lecture");
    await mkdir(folder, { recursive: true });
    const transcript = path.join(folder, "captions.txt");
    await writeFile(transcript, "Both inputs must be true.\n0:07");
    const adapter = new FileSystemAdapter();
    (adapter as unknown as { base: string }).base = root;
    const app = {
      vault: {
        adapter,
        createFolder: async (p: string) => mkdir(path.join(root, p)),
        create: async (p: string, data: string) => {
          await writeFile(path.join(root, p), data);
          return { path: p };
        },
      },
      workspace: { getLeaf: () => ({ openFile: vi.fn() }) },
    } as unknown as App;
    const plugin = new PanoptoStudy(app, { id: "panopto-study" } as never);
    plugin.settings = {
      ...plugin.settings,
      provider: "ollama",
      localModel: "fixture",
    };
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      json: { message: { content: JSON.stringify(study) } },
    } as never);
    const result = {
      type: "result" as const,
      folder,
      title: "Lecture",
      partial: false,
      transcripts: [{ path: transcript, warning: "Fictional snapshot" }],
    };
    const prepare = vi
      .spyOn(learningExports, "referenceHelper")
      .mockReturnValue(async () => ({
        version: 1,
        feeds: [],
        frames: [],
        warnings: [],
        sampling: "Fictional fixture",
      }));
    await plugin.writeNote(
      result,
      () => {},
      async () => true,
      () => false,
      undefined,
      "Course/Topic",
    );
    expect(
      await readFile(path.join(folder, "learning/index.html"), "utf8"),
    ).toContain("<script>");
    expect(await readdir(folder)).not.toContain("Lecture.md");
    expect(shell.openPath).toHaveBeenCalledWith(
      await realpath(path.join(folder, "learning/index.html")),
    );
    prepare.mockRestore();
    const failed = vi
      .spyOn(learningExports, "referenceHelper")
      .mockReturnValue(async () => {
        throw new Error("Fictional HTML preparation failure");
      });
    await expect(
      plugin.writeNote(
        result,
        () => {},
        async () => true,
        () => false,
        undefined,
        "Course/Topic",
      ),
    ).rejects.toThrow("HTML preparation failure");
    expect(await readdir(folder)).not.toContain("Lecture.md");
    failed.mockRestore();
    await plugin.writeNote(
      result,
      () => {},
      async () => true,
      () => false,
      false,
      "Course/Topic",
    );
    expect(await readFile(path.join(folder, "Lecture.md"), "utf8")).toContain(
      "Both inputs must be true.",
    );
    expect(
      await readdir(path.join(folder, "Generated Cache")),
    ).not.toHaveLength(0);
    expect(await readdir(root)).toEqual(["Course"]);
    const other = path.join(root, "Other");
    await mkdir(other);
    await expect(
      plugin.writeNote(
        { ...result, folder: other },
        () => {},
        async () => true,
        () => false,
        false,
        "Course/Topic",
      ),
    ).rejects.toThrow("outside");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
