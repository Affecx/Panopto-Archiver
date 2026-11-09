import { it, expect, vi } from "vitest";
import {
  evidenceFromText,
  generateStudy,
  renderStudy,
  validateStudy,
  type Evidence,
} from "../src/study";
const example = {
  summary: "Boolean logic overview",
  takeaways: [{ text: "An AND gate needs both inputs.", evidence: ["E1"] }],
  examples: [
    {
      title: "Evaluate AND",
      problem: "A=1 and B=0. Find A AND B.",
      steps: ["Use the AND truth table.", "Inputs differ, so the output is 0."],
      answer: "0",
      check: "Only 1 AND 1 yields 1.",
      evidence: ["E1"],
    },
  ],
  questions: ["When is AND true?"],
};
it("preserves observed start labels and only strips controls in verified UI context", () => {
  const cues = evidenceFromText(
    "Retry\nCancel\nBoth inputs must be true.\n0:07",
    "captions.txt",
    true,
  );
  expect(cues[0]).toMatchObject({
    text: "Both inputs must be true.",
    source: "captions.txt · 0:07",
  });
  expect(evidenceFromText("Cancel\n0:00", "plain.txt")[0]?.text).toBe("Cancel");
});
it("rejects fabricated citations and missing worked solution steps", () => {
  expect(() =>
    validateStudy(
      JSON.stringify({
        ...example,
        takeaways: [{ text: "Claim", evidence: ["E404"] }],
      }),
      new Set(["E1"]),
    ),
  ).toThrow();
  expect(() =>
    validateStudy(
      JSON.stringify({
        ...example,
        examples: [{ ...example.examples[0], steps: [] }],
      }),
      new Set(["E1"]),
    ),
  ).toThrow();
});
it("uses compact ID/text pairs and caches validated unchanged chunks", async () => {
  const evidence: Evidence[] = [
    {
      id: "E1",
      text: "Both inputs must be true.",
      source: "captions.txt · 0:07",
    },
  ];
  const chat = vi.fn(async () => JSON.stringify(example));
  const saved = new Map<string, string>();
  const cache = {
    get: async (k: string) => saved.get(k),
    set: async (k: string, v: string) => {
      saved.set(k, v);
    },
  };
  await generateStudy(evidence, chat, () => {}, cache);
  await generateStudy(evidence, chat, () => {}, cache);
  expect(chat).toHaveBeenCalledTimes(1);
  const user = (chat.mock.calls[0] as unknown as string[])[1]!;
  expect(user).not.toContain("captions.txt");
  expect(JSON.parse(user).lecture_data).toEqual([
    ["E1", "Both inputs must be true."],
  ]);
});
it("never executes instructions from model output and escapes embeds", () => {
  const output = renderStudy(
    "Lecture",
    [
      {
        ...example,
        summary:
          "<script>alert(1)</script> ![image](https://example.com/pixel)",
      },
    ],
    [{ id: "E1", text: "Example", source: "source" }],
    ["Partial transcript"],
  );
  expect(output).not.toContain("<script>");
  expect(output).toContain("\\!\\[image\\]");
  expect(output).toContain("examples_executed: false");
  expect(output).toContain("[[#^E1|E1]]");
});
it("does not call a model for a missing transcript", async () => {
  const chat = vi.fn();
  await expect(generateStudy([], chat, () => {})).rejects.toThrow(
    "No transcript",
  );
  expect(chat).not.toHaveBeenCalled();
});
it("can send a full lecture in one bounded request for the API", async () => {
  const text = "a".repeat(12000);
  const chat = vi.fn(async () => JSON.stringify(example));
  await generateStudy(
    [{ id: "E1", text, source: "test" }],
    chat,
    () => {},
    undefined,
    80000,
  );
  expect(chat).toHaveBeenCalledTimes(1);
});

it("keeps large citation schemas compact while still rejecting unknown source references", async () => {
  const { studySchema } = await import("../src/schema");
  const data = Array.from({ length: 492 }, (_, i) => [`E${i + 1}`, "text"]);
  const schema = JSON.stringify(
    studySchema(JSON.stringify({ lecture_data: data })),
  );
  expect(schema.length).toBeLessThan(1800);
  expect(() =>
    validateStudy(
      JSON.stringify({
        ...example,
        takeaways: [{ text: "Unsupported claim", evidence: ["E999"] }],
      }),
      new Set(data.map((item) => item[0]!)),
    ),
  ).toThrow();
});

it("flags circular examples and unsafe unbounded C input without executing or silently correcting them", async () => {
  const { qualityWarnings } = await import("../src/study");
  const study = {
    ...example,
    examples: [
      {
        ...example.examples[0]!,
        steps: ["1. Write the program.", "2. Write the program."],
        answer: 'scanf("%s", &name);',
      },
    ],
  };
  const warnings = qualityWarnings(study);
  expect(warnings.some((message) => message.includes("repeats"))).toBe(true);
  expect(warnings.some((message) => message.includes("unbounded"))).toBe(true);
  const note = renderStudy(
    "Lecture",
    [study],
    [{ id: "E1", text: "Source", source: "text" }],
    [],
  );
  expect(note).toContain("Review required");
});
