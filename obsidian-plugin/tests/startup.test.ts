import { it, expect } from "vitest";
import { build } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
it("loads the actual CommonJS build and registers plugin commands without a model or credentials", async () => {
  const output = await build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    external: ["obsidian", "electron"],
    write: false,
  });
  const commands: unknown[] = [];
  const settings: unknown[] = [];
  let fileMenu: (menu: unknown, file: unknown) => void = () => {};
  class File {}
  class Folder {}
  class Plugin {
    settings: unknown;
    app = {
      workspace: {
        on: (name: string, callback: typeof fileMenu) => {
          if (name === "file-menu") fileMenu = callback;
          return {};
        },
      },
    };
    registerEvent() {}
    async loadData() {
      return {
        macros: [
          {
            name: "Fixture",
            prompt: "Summarize this file.",
            includeParent: false,
          },
        ],
      };
    }
    addCommand(command: unknown) {
      commands.push(command);
    }
    addSettingTab(tab: unknown) {
      settings.push(tab);
    }
    addRibbonIcon() {}
  }
  class PluginSettingTab {
    constructor(
      public app: unknown,
      public plugin: unknown,
    ) {}
  }
  const nodeRequire = createRequire(import.meta.url);
  const sdk = {
    Plugin,
    PluginSettingTab,
    Modal: class {},
    FuzzySuggestModal: class {},
    TFolder: Folder,
    TFile: File,
    FileSystemAdapter: class {},
  };
  const module = {
    exports: {} as { default?: new () => { onload: () => Promise<void> } },
  };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (name: string) =>
      name === "obsidian"
        ? sdk
        : name === "electron"
          ? { shell: { openPath: async () => "" } }
          : nodeRequire(name),
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
  });
  new vm.Script(output.outputFiles[0]!.text).runInContext(context);
  const Constructor = module.exports.default;
  expect(Constructor).toBeTypeOf("function");
  const plugin = new Constructor!();
  await plugin.onload();
  expect(commands).toEqual([expect.objectContaining({ id: "import-lecture" })]);
  expect(settings).toHaveLength(1);
  const titles: string[] = [];
  const item = {
    setTitle(title: string) {
      titles.push(title);
      return this;
    },
    setIcon() {
      return this;
    },
    onClick() {
      return this;
    },
  };
  const menu = {
    addItem(add: (item: unknown) => void) {
      add(item);
    },
  };
  fileMenu(menu, new Folder());
  expect(titles.splice(0)).toEqual([
    "Import Panopto lecture here",
    "Create learning page from folder",
    "AI macros…",
  ]);
  fileMenu(menu, new File());
  expect(titles).toEqual(["AI macros…"]);
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  expect(manifest.id).toBe("panopto-study");
  expect(manifest.isDesktopOnly).toBe(true);
});
