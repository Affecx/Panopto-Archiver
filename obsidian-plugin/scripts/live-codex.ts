import { writeFile } from "node:fs/promises";
import { generateStudy, renderStudy } from "../src/study";
import { codexChat } from "../src/codex";
import type { Usage } from "../src/model";
const usage: Usage[] = [];
const chat = codexChat(
  process.env.PANOPTO_CODEX_EXECUTABLE || "codex",
  process.env.PANOPTO_CODEX_TEST_MODEL || "",
  (u) => usage.push(u),
);
const evidence = [
  {
    id: "E1",
    text: "A two-input AND gate returns 1 only if both inputs are 1. Thus 1 AND 0 returns 0.",
    source: "Fictional test lecture · 0:00",
  },
];
const studies = await generateStudy(
  evidence,
  chat,
  console.log,
  undefined,
  80000,
);
await writeFile(
  "dist/codex-test-study.md",
  renderStudy("Fictional Codex Integration Check", studies, evidence, [
    "Generated from a synthetic fixture, not university content.",
  ]),
);
console.log("Live Codex check passed. Usage:", JSON.stringify(usage));
