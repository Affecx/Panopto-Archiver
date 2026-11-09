import { writeFile } from "node:fs/promises";
import { generateStudy, renderStudy } from "../src/study";
import { ollamaChat } from "../src/model";
const model = process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b";
const chat = ollamaChat(
  "http://127.0.0.1:11434",
  model,
  async (url, body) => {
    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    if (!result.ok) throw new Error("Local model request failed");
    return result.json();
  },
  1400,
);
const evidence = [
  {
    id: "E1",
    text: "A two-input AND gate outputs 1 only when both inputs are 1. If input A is 1 and input B is 0, the output is 0. This can be checked using the AND truth table.",
    source: "Fictional test lecture · 0:00",
  },
];
const study = await generateStudy(evidence, chat, console.log);
if (
  !study[0]?.summary ||
  !study[0].examples.length ||
  !study[0].takeaways.length
)
  throw new Error("Missing study sections");
await writeFile(
  "dist/local-test-study.md",
  renderStudy("Fictional Boolean Logic Lecture", study, evidence, [
    "Synthetic fixture, not a university lecture.",
  ]),
);
console.log(
  "Live local model check passed: validated study JSON, source citations, worked example and Markdown output.",
);
