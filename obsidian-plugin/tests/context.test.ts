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
import { contextScope } from "../src/context";
import { folderReferences, folderSources } from "../src/folder-study";
import { exportLearningPage } from "../src/learning-export";
import {
  applyMacroPlan,
  planMacroTask,
  readMacroContext,
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
    expect(await readMacroContext(root, single, 10000)).toEqual([
      { path: "Topic/Notes.md", text: "Original" },
    ]);
    const snapshot = await readMacroContext(root, folder, 10000);
    expect(snapshot.map((file) => file.path)).toEqual([
      "Topic/Notes.md",
      "Topic/sub/Lesson.py",
    ]);
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
    const files = await readMacroContext(root, scope, 10000);
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
      files,
      limit: 10000,
      prompt: "Revise the draft.",
      selection: { path: original, type: "file" },
      chat: async (_system, input) => {
        calls++;
        const data = JSON.parse(input);
        expect(data.files).toEqual(files);
        expect(input).not.toContain("Declined text");
        if (calls === 1) {
          expect(data.additionalFiles).toBeUndefined();
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
        expect(data.additionalFiles).toEqual([
          { path: extra, text: "Text after approval" },
        ]);
        expect(data.contextDecisions).toEqual([
          { path: "Course/Week2", status: "added" },
          { path: declined, status: "declined" },
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
    expect(plan?.edits).toEqual([
      { path: original, action: "replace", text: "Revised" },
    ]);
    expect(await readFile(path.join(root, original), "utf8")).toBe("Draft");
    expect(calls).toBe(2);

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
