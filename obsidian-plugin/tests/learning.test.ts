import { it, expect } from "vitest";
import {
  renderLearningPage,
  sourceTime,
  localAsset,
  type ReferenceMedia,
} from "../src/learning";
import { exportLearningPage } from "../src/learning-export";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const evidence = [
  {
    id: "E1",
    text: "A fictional compiler translates source into executable instructions.",
    source: "fictional.txt · 0:07",
  },
];
const study = {
  summary: "Fictional compilation",
  takeaways: [{ text: "Translate before execution", evidence: ["E1"] }],
  examples: [
    {
      title: "Fictional example",
      problem: "Explain the cycle",
      steps: ["Edit.", "Compile."],
      answer: "Run the executable.",
      check: "Check diagnostics.",
      evidence: ["E1"],
    },
  ],
  questions: ["Why compile?"],
};
const media: ReferenceMedia = {
  version: 1,
  feeds: [],
  frames: [],
  warnings: ["No local video"],
  sampling: "Fictional fixture",
};
it("requires raw sources and confines asset paths instead of embedding arbitrary URLs or scripts", () => {
  expect(sourceTime(evidence[0]!)).toBe(7);
  expect(
    sourceTime({ ...evidence[0]!, source: "caption.txt" }),
  ).toBeUndefined();
  for (const p of [
    "https://bad.invalid/a",
    "../secret",
    "/etc/passwd",
    "frames/../../secret",
    "x\\y",
    "x?token=secret",
  ])
    expect(() => localAsset(p)).toThrow();
  const attack = "</script><script>globalThis.evil=1</script>";
  const html = renderLearningPage(
    attack,
    [{ ...study, summary: attack }],
    [{ ...evidence[0]!, text: attack }],
    media,
  );
  expect(html).not.toContain(attack);
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("script-src 'sha256-");
  expect(() => renderLearningPage("x", [study], [], media)).toThrow();
  expect(() =>
    renderLearningPage(
      "x",
      [{ ...study, takeaways: [{ text: "Bad", evidence: ["E99"] }] }],
      evidence,
      media,
    ),
  ).toThrow();
});
it("writes a real page from original evidence, preserves previous output and rejects escaped assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lecture-html-"));
  try {
    const folder = path.join(root, "archive");
    await mkdir(folder);
    const options = {
      folder,
      title: "Fictional lecture",
      studies: [study],
      evidence,
      warnings: [],
      ffmpeg: "",
      ffprobe: "",
    };
    const first = await exportLearningPage(options, async () => media);
    const second = await exportLearningPage(options, async () => media);
    expect(first).not.toBe(second);
    expect(await readFile(first, "utf8")).toContain(evidence[0]!.text);
    const outside = path.join(root, "outside.mp4");
    await writeFile(outside, "outside");
    await mkdir(path.join(folder, "media"));
    await symlink(outside, path.join(folder, "media/escape.mp4"));
    await expect(
      exportLearningPage(options, async () => ({
        ...media,
        feeds: [
          {
            id: "F1",
            label: "unclassified",
            path: "media/escape.mp4",
            duration: 1,
            hasAudio: true,
            role: "unclassified",
            alignment: "unverified",
          },
        ],
      })),
    ).rejects.toThrow("outside");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
