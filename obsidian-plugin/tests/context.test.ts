import { expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  contextScope,
  readContextText,
  type ContextFile,
} from "../src/context";
import { folderReferences, folderSources } from "../src/folder-study";
import { exportLearningPage } from "../src/learning-export";
import {
  applyMacroPlan,
  planMacroTask,
  validateMacroPlan,
} from "../src/macros";
import { generateStudy, type Study } from "../src/study";

async function withVault(work: (root: string) => Promise<void>) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "study-context-")),
  );
  try {
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("gathers a folder's notes and local captions, cites both, and writes the page beside them", async () =>
  withVault(async (root) => {
    for (const directory of [
      "Topic/Lecture/metadata",
      "Topic/Lecture/transcripts",
      "Topic/sub",
      "Topic/Generated Cache",
      "Other",
    ])
      await mkdir(path.join(root, directory), { recursive: true });
    const put = (relative: string, text: string) =>
      writeFile(path.join(root, relative), text);
    await put("Topic/Notes.md", "Student notes on the fictional pipeline.");
    await put(
      "Topic/sub/Lecture notes.md",
      "Another note in the chosen folder.",
    );
    await put("Topic/Generated Cache/ignored.md", "Cache only.");
    await put("Other/Private.md", "Outside the folder.");
    await symlink(path.join(root, "Other"), path.join(root, "Topic/linked"));
    await put(
      "Topic/Lecture/transcripts/001_captions.txt",
      "Fictional lecture narration.\n0:09",
    );
    await put(
      "Topic/Lecture/metadata/resources.json",
      JSON.stringify({
        version: 2,
        title: "Fictional lecture",
        resources: [
          {
            kind: "captions",
            source: "semantic caption panel snapshot",
            outcome: "success",
            files: [
              "transcripts/001_captions.txt",
              "transcripts/../../Other/Private.md.txt",
            ],
          },
        ],
      }),
    );
    const sources = await folderSources(root, "Topic", 10000);
    expect(sources.inputs).toEqual([
      "Topic/Lecture/transcripts/001_captions.txt",
      "Topic/Notes.md",
      "Topic/sub/Lecture notes.md",
    ]);
    expect(sources.evidence.map((item) => item.kind)).toEqual([
      "caption",
      "note",
      "note",
    ]);
    const study: Study = {
      summary: "Fictional teaching material",
      takeaways: [{ text: "Combine evidence", evidence: ["E1", "E2"] }],
      examples: [],
      questions: [],
      lessons: [
        {
          title: "Fictional pipeline",
          explanation: "Read the notes.",
          walkthrough: "Follow the pipeline.",
          misconception: "A caveat.",
          question: "What changed?",
          answer: "The input.",
          evidence: ["E1", "E2"],
          practice: {
            goal: "Follow a step.",
            setup: "Start here.",
            hint: "Read the input.",
            recallQuestion: "What is used?",
            recallAnswer: "Input.",
          },
        },
      ],
    };
    const studies = await generateStudy(
      sources.evidence,
      async (_system, request) => {
        expect(JSON.parse(request)).toMatchObject({
          context: "folder",
          lecture_data: [
            ["E1", "Fictional lecture narration.", "caption"],
            ["E2", "Student notes on the fictional pipeline.", "note"],
            ["E3", "Another note in the chosen folder.", "note"],
          ],
        });
        return JSON.stringify(study);
      },
      () => {},
      undefined,
      10000,
      true,
      true,
    );
    const folder = path.join(root, "Topic");
    const page = await exportLearningPage(
      {
        folder,
        title: "Topic",
        studies,
        evidence: sources.evidence,
        warnings: sources.warnings,
        ffmpeg: "",
        ffprobe: "",
      },
      folderReferences(sources.archives, "Topic", async (options) => {
        expect(options.folder).toBe(path.join(folder, "Lecture"));
        expect(options.anchors).toEqual([9]);
        return {
          version: 1,
          feeds: [],
          frames: [],
          warnings: [],
          sampling: "Fixture",
        };
      }),
    );
    expect(page).toBe(path.join(folder, "learning/index.html"));
    expect(await readFile(page, "utf8")).toContain(
      "Student notes on the fictional pipeline.",
    );
    const noteOnly = await folderSources(root, "Topic/sub", 10000);
    expect(noteOnly.archives).toEqual([]);
    expect(noteOnly.evidence[0]?.kind).toBe("note");
  }));

it("limits macro reads and writes to the selected file or folder and refuses stale edits", async () =>
  withVault(async (root) => {
    for (const folder of ["Topic", "Topic/sub", "Topic-extra"])
      await mkdir(path.join(root, folder));
    const put = (relative: string, text: string | Buffer) =>
      writeFile(path.join(root, relative), text);
    await put("Topic/Notes.md", "Original");
    await put("Topic/sub/Lesson.py", "print(1)");
    await put("Topic/.hidden", "hidden");
    await put("Topic/asset.png", Buffer.from([137, 80, 78, 71, 0]));
    await put("Topic-extra/Outside.md", "outside");
    await symlink(
      path.join(root, "Topic-extra"),
      path.join(root, "Topic/linked"),
    );
    const single = contextScope("Topic/Notes.md", false, false);
    const folder = contextScope("Topic/Notes.md", false, true);
    expect(contextScope("Topic", true, false)).toEqual(folder);
    const snapshot = await Promise.all(
      ["Topic/Notes.md", "Topic/sub/Lesson.py"].map(async (path) => ({
        path,
        text: (await readContextText(root, path, 10000))!,
      })),
    );
    expect(
      await readContextText(root, "Topic/asset.png", 10000),
    ).toBeUndefined();
    const proposal = (
      target: string,
      action: "create" | "replace",
      text = "New text",
    ) =>
      JSON.stringify({
        summary: "Edit",
        edits: [{ path: target, action, text }],
      });
    for (const target of [
      "Topic-extra/New.md",
      "Topic/../Outside.md",
      "Topic/.obsidian/config",
      "Topic/id_rsa",
    ])
      expect(() =>
        validateMacroPlan(proposal(target, "create"), folder, snapshot),
      ).toThrow();
    expect(() =>
      validateMacroPlan(
        proposal("Topic/sub/Lesson.py", "replace"),
        single,
        snapshot,
      ),
    ).toThrow();
    const process = async (
      relative: string,
      update: (value: string) => string,
    ) =>
      put(relative, update(await readFile(path.join(root, relative), "utf8")));
    const linked = validateMacroPlan(
      proposal("Topic/linked/New.md", "create"),
      folder,
      snapshot,
    );
    await expect(
      applyMacroPlan(root, linked, snapshot, process),
    ).rejects.toThrow(/Linked/);
    const plan = validateMacroPlan(
      JSON.stringify({
        summary: "Edit two files",
        edits: [
          { path: "Topic/Notes.md", action: "replace", text: "Updated" },
          { path: "Topic/sub/New.md", action: "create", text: "Created" },
        ],
      }),
      folder,
      snapshot,
    );
    await put("Topic/Notes.md", "Changed");
    await expect(applyMacroPlan(root, plan, snapshot, process)).rejects.toThrow(
      /changed after review/,
    );
    await expect(
      readFile(path.join(root, "Topic/sub/New.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await put("Topic/Notes.md", "Original");
    expect(await applyMacroPlan(root, plan, snapshot, process)).toBe(2);
    expect(await readFile(path.join(root, "Topic/Notes.md"), "utf8")).toBe(
      "Updated",
    );
    expect(await readFile(path.join(root, "Topic/sub/New.md"), "utf8")).toBe(
      "Created",
    );
  }));

it("shares only approved wider context on subsequent turns and keeps the original write scope", async () =>
  withVault(async (root) => {
    for (const folder of ["Course/Week1", "Course/Week2", "Course/Private"])
      await mkdir(path.join(root, folder), { recursive: true });
    const original = "Course/Week1/Task.md";
    const extra = "Course/Week2/Reference.md";
    const declined = "Course/Private/Notes.md";
    await writeFile(path.join(root, original), "Draft");
    await writeFile(path.join(root, extra), "Text before approval");
    await writeFile(path.join(root, declined), "Declined text");
    const scope = contextScope(original, false, false);
    const response = (edits: unknown[] = [], contextRequests: unknown[] = []) =>
      JSON.stringify({ summary: "Test", edits, contextRequests });
    const request = (path: string, kind: "file" | "folder" = "file") => ({
      path,
      kind,
      reason: "Needed for a fictional task.",
    });
    let calls = 0;
    const options: Parameters<typeof planMacroTask>[0] = {
      root,
      scope,
      limit: 10000,
      prompt: "Revise the draft.",
      selection: { path: original, type: "file" },
      chat: async (_system, input) => {
        calls++;
        const data = JSON.parse(input);
        expect(input).not.toContain("Declined text");
        if (calls === 1) {
          expect(data.files).toEqual([]);
          expect(data.tree).toEqual([]);
          expect(data.canRequestContext).toBe(true);
          return response(
            [],
            [
              request("Course/Week2", "folder"),
              request(declined),
              request("../outside"),
            ],
          );
        }
        if (calls === 2) {
          expect(data.files).toEqual([]);
          expect(data.tree).toEqual([
            {
              path: "Course/Week2",
              offset: 0,
              nextOffset: null,
              entries: [{ name: "Reference.md", kind: "file" }],
            },
          ]);
          expect(data.contextDecisions).toEqual([
            { path: "Course/Week2", status: "listed" },
            { path: declined, status: "declined" },
          ]);
          return response([], [request(extra), request(original)]);
        }
        expect(data.files).toEqual([
          { path: extra, text: "Text after approval" },
          { path: original, text: "Draft" },
        ]);
        return response([
          { path: original, action: "replace", text: "Revised" },
        ]);
      },
      approve: async (requests) => {
        expect(requests.map((item) => item.path)).toEqual([
          "Course/Week2",
          declined,
        ]);
        await writeFile(path.join(root, extra), "Text after approval");
        return new Set(["Course/Week2", "../outside"]);
      },
    };
    const plan = await planMacroTask(options);
    expect(plan?.plan.edits).toEqual([
      { path: original, action: "replace", text: "Revised" },
    ]);
    expect(await readFile(path.join(root, original), "utf8")).toBe("Draft");
    expect(plan?.files).toEqual([{ path: original, text: "Draft" }]);
    expect(calls).toBe(3);

    let turns = 0;
    await expect(
      planMacroTask({
        ...options,
        approve: async () => new Set([extra]),
        chat: async () =>
          ++turns === 1
            ? response([], [request(extra)])
            : response([
                { path: extra, action: "replace", text: "Outside write" },
              ]),
      }),
    ).rejects.toThrow(/outside the approved context/);
    turns = 0;
    await expect(
      planMacroTask({
        ...options,
        approve: async () => null,
        chat: async () => {
          turns++;
          return response([], [request(extra)]);
        },
      }),
    ).resolves.toBeUndefined();
    expect(turns).toBe(1);
  }));

it("browses a folder above the input budget and reads only the files the model selects", async () =>
  withVault(async (root) => {
    const folder = "Course";
    await mkdir(path.join(root, folder, "Notes"), { recursive: true });
    await mkdir(path.join(root, "Outside"));
    const put = (relative: string, text: string) =>
      writeFile(path.join(root, folder, relative), text);
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        put(
          `Log-${String(index).padStart(2, "0")}.md`,
          "Unrelated " + "x".repeat(5000),
        ),
      ),
    );
    await put(".private", "Hidden");
    await symlink(
      path.join(root, "Outside"),
      path.join(root, folder, "linked"),
    );
    const first = "Course/Notes/Background.md";
    const target = "Course/Notes/Target.md";
    const background = "Relevant background " + "x".repeat(3200);
    const original = "Original target " + "y".repeat(3200);
    await put("Notes/Background.md", background);
    await put("Notes/Target.md", original);

    const request = (
      path: string,
      kind: "folder" | "file",
      offset?: number,
    ) => ({ path, kind, offset, reason: "Find the relevant source" });
    type BrowseInput = {
      files: ContextFile[];
      tree: {
        offset: number;
        nextOffset: number | null;
        entries: { name: string; kind: string }[];
      }[];
      workingNotes?: string;
    };
    const steps = [
      (data: BrowseInput) => {
        expect(data.files).toEqual([]);
        expect(data.tree[0]!.entries).toHaveLength(24);
        return {
          contextRequests: [
            request(folder, "folder", data.tree[0]!.nextOffset ?? undefined),
          ],
        };
      },
      (data: BrowseInput) => {
        expect(data.tree[0]!.offset).toBe(24);
        return {
          contextRequests: [
            request(folder, "folder", data.tree[0]!.nextOffset ?? undefined),
          ],
        };
      },
      (data: BrowseInput) => {
        expect(data.tree[0]!.entries).toContainEqual({
          name: "Notes",
          kind: "folder",
        });
        expect(data.tree[0]!.entries).not.toContainEqual({
          name: "linked",
          kind: "folder",
        });
        return { contextRequests: [request("Course/Notes", "folder")] };
      },
      (data: BrowseInput) => {
        expect(data.tree.at(-1)!.entries).toEqual([
          { name: "Background.md", kind: "file" },
          { name: "Target.md", kind: "file" },
        ]);
        expect(data.files).toEqual([]);
        return { contextRequests: [request(first, "file")] };
      },
      (data: BrowseInput) => {
        expect(data.files).toEqual([{ path: first, text: background }]);
        return {
          contextRequests: [request(target, "file")],
          workingNotes: "Keep the main conclusion from the background.",
          releaseFiles: [first],
        };
      },
      (data: BrowseInput) => {
        expect(data.files).toEqual([{ path: target, text: original }]);
        expect(data.workingNotes).toContain("main conclusion");
        return {
          edits: [{ path: target, action: "replace", text: "Revised" }],
        };
      },
    ];
    const result = await planMacroTask({
      root,
      scope: { folder },
      selection: { path: folder, type: "folder" },
      prompt: "Revise the target note using the background.",
      limit: 5000,
      approve: async () => {
        throw new Error("In-scope requests need no further approval");
      },
      chat: async (_system, input) => {
        expect(Buffer.byteLength(input)).toBeLessThanOrEqual(5000);
        expect(input).not.toContain("Unrelated");
        const step = steps.shift()!;
        return JSON.stringify({
          summary: "Test",
          edits: [],
          contextRequests: [],
          ...step(JSON.parse(input)),
        });
      },
    });
    expect(steps).toHaveLength(0);
    expect(result?.plan.edits).toEqual([
      { path: target, action: "replace", text: "Revised" },
    ]);
    expect(result?.files).toEqual([{ path: target, text: original }]);
  }));
