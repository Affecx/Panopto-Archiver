// @vitest-environment jsdom
import { it, expect } from "vitest";
import {
  selectedSidebarFolder,
  destinationPath,
  newFolderPath,
  createDestination,
} from "../src/destination";
it("uses only an existing, unambiguous folder in the sidebar, not the active editor", () => {
  document.body.innerHTML =
    '<div data-type="file-explorer"><div class="nav-folder-title is-selected" data-path="Course/Lecture"></div></div><div class="nav-folder-title is-selected" data-path="Wrong"></div>';
  expect(selectedSidebarFolder(document, (p) => p === "Course/Lecture")).toBe(
    "Course/Lecture",
  );
  expect(selectedSidebarFolder(document, () => false)).toBeNull();
  document.querySelector("[data-type=file-explorer]")!.innerHTML +=
    '<div class="nav-folder-title is-selected" data-path="Other"></div>';
  expect(selectedSidebarFolder(document, () => true)).toBeNull();
  document.body.innerHTML =
    '<div data-type="file-explorer"><div class="nav-file-title is-selected" data-path="Course/note.md"></div></div>';
  expect(selectedSidebarFolder(document, () => true)).toBeNull();
  expect(selectedSidebarFolder(undefined, () => true)).toBeNull();
});
it("accepts vault root and normal folders, and rejects traversal and hidden folders", () => {
  expect(destinationPath("/")).toBe("");
  expect(destinationPath("Course/02 - Learning C")).toBe(
    "Course/02 - Learning C",
  );
  for (const p of [
    "../escape",
    "/absolute",
    "Course/../escape",
    ".obsidian/plugins",
    "Course\\Other",
    "file://x",
  ])
    expect(() => destinationPath(p)).toThrow();
});

it("creates a chosen child folder and refuses missing parents, collisions and unsafe names", async () => {
  const folders = new Map([["Course", { path: "Course" }]]);
  const vault = {
    getFolderByPath: (p: string) => folders.get(p) ?? null,
    getRoot: () => ({ path: "/" }),
    getAbstractFileByPath: (p: string) => folders.get(p),
    createFolder: async (p: string) => {
      const folder = { path: p };
      folders.set(p, folder);
      return folder;
    },
  };
  expect(newFolderPath("Course", " Lecture 3 ")).toBe("Course/Lecture 3");
  expect(await createDestination(vault, "Course", "Lecture 3")).toEqual({
    path: "Course/Lecture 3",
  });
  await expect(createDestination(vault, "Course", "Lecture 3")).rejects.toThrow(
    "exists",
  );
  await expect(createDestination(vault, "Missing", "Lecture")).rejects.toThrow(
    "parent",
  );
  for (const name of ["../escape", "a/b", ".obsidian", ""])
    expect(() => newFolderPath("Course", name)).toThrow();
});
