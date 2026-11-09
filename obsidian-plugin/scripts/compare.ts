import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mergeTranscripts } from "../src/transcripts";
import { generateStudy, renderStudy } from "../src/study";
import { ollamaChat, type Usage, type LocalUsage } from "../src/model";
import { studySchema } from "../src/schema";
import { codexChat } from "../src/codex";
const source = process.env.PANOPTO_BENCHMARK_SOURCE;
if (!source)
  throw new Error(
    "Set PANOPTO_BENCHMARK_SOURCE to the captured archive folder",
  );
const manifest = JSON.parse(
  await readFile(path.join(source, "metadata/resources.json"), "utf8"),
) as {
  title: string;
  partial: boolean;
  resources: {
    kind: string;
    source: string;
    files: string[];
    warning?: string;
  }[];
};
const entries = [];
const warnings = new Set<string>();
for (const resource of manifest.resources) {
  if (resource.kind !== "captions") continue;
  for (const file of resource.files) {
    if (!file.endsWith(".txt")) continue;
    const target = path.resolve(source, file);
    const relative = path.relative(path.resolve(source), target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Invalid archive path");
    entries.push({
      text: await readFile(target, "utf8"),
      source: path.basename(file),
      panelSnapshot: resource.source === "semantic caption panel snapshot",
    });
  }
  if (resource.warning) warnings.add(resource.warning);
}
const merged = mergeTranscripts(entries);
if (!merged.evidence.length)
  throw new Error("No transcript; no provider requests made");
const fingerprint = createHash("sha256")
  .update(JSON.stringify(merged.evidence.map((e) => [e.id, e.text])))
  .digest("hex");
const output = path.resolve("benchmark-results", fingerprint.slice(0, 12));
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "input-evidence.json"),
  JSON.stringify(merged.evidence, null, 2),
);
const report: {
  title: string;
  transcriptHash: string;
  rawBytes: number;
  cleanBytes: number;
  duplicates: number;
  evidenceCount: number;
  partial: boolean;
  warnings: string[];
  runs: unknown[];
} = {
  title: manifest.title,
  transcriptHash: fingerprint,
  rawBytes: merged.rawBytes,
  cleanBytes: merged.cleanBytes,
  duplicates: merged.duplicates,
  evidenceCount: merged.evidence.length,
  partial: manifest.partial,
  warnings: [...warnings],
  runs: [],
};
const runId =
  new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid;
const localCap = Number(process.env.PANOPTO_LOCAL_OUTPUT_TOKENS || 1800);
if (!Number.isInteger(localCap) || localCap < 300 || localCap > 4000)
  throw new Error("Local output limit must be 300–4000 tokens");
const selectedProviders = (
  process.env.PANOPTO_BENCHMARK_PROVIDERS || "ollama,codex"
).split(",");
for (const provider of (["ollama", "codex"] as const).filter((value) =>
  selectedProviders.includes(value),
)) {
  const usage: (Usage | LocalUsage)[] = [];
  let calls = 0,
    cacheHits = 0;
  const base =
    provider === "ollama"
      ? ollamaChat(
          "http://127.0.0.1:11434",
          process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b",
          async (url, body) => {
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(180000),
            });
            if (!response.ok)
              throw new Error(`Local provider HTTP ${response.status}`);
            return response.json();
          },
          localCap,
          (u) => usage.push(u),
        )
      : codexChat(
          process.env.PANOPTO_CODEX_EXECUTABLE || "codex",
          process.env.PANOPTO_CODEX_TEST_MODEL || "",
          (u) => usage.push(u),
        );
  const chat = async (system: string, user: string) => {
    calls++;
    return base(system, user);
  };
  const started = performance.now();
  let status = "success",
    error: string | undefined;
  const cache = {
    get: async (input: string) => {
      const key = createHash("sha256")
        .update(
          JSON.stringify({
            provider,
            model:
              provider === "ollama"
                ? process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b"
                : process.env.PANOPTO_CODEX_TEST_MODEL || "CLI default",
            cap: provider === "ollama" ? localCap : 1800,
            context: 8192,
            version: 3,
            input,
            schema: studySchema(input),
          }),
        )
        .digest("hex");
      try {
        const value = await readFile(
          path.join(output, `cache-${key}.json`),
          "utf8",
        );
        cacheHits++;
        return value;
      } catch {
        if (provider === "ollama" && localCap > 1800) {
          const prior = createHash("sha256")
            .update(
              JSON.stringify({
                provider,
                model: process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b",
                cap: 1800,
                context: 8192,
                version: 3,
                input,
                schema: studySchema(input),
              }),
            )
            .digest("hex");
          try {
            const value = await readFile(
              path.join(output, `cache-${prior}.json`),
              "utf8",
            );
            cacheHits++;
            return value;
          } catch {}
        }
        return undefined;
      }
    },
    set: async (input: string, value: string) => {
      const key = createHash("sha256")
        .update(
          JSON.stringify({
            provider,
            model:
              provider === "ollama"
                ? process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b"
                : process.env.PANOPTO_CODEX_TEST_MODEL || "CLI default",
            cap: provider === "ollama" ? localCap : 1800,
            context: 8192,
            version: 3,
            input,
            schema: studySchema(input),
          }),
        )
        .digest("hex");
      await writeFile(path.join(output, `cache-${key}.json`), value);
    },
  };
  try {
    const studies = await generateStudy(
      merged.evidence,
      chat,
      (message) => console.log(provider + ": " + message),
      cache,
      provider === "codex" ? 1000000 : 8500,
    );
    await writeFile(
      path.join(output, `${provider}-study.json`),
      JSON.stringify(studies, null, 2),
    );
    await writeFile(
      path.join(output, `${provider}-study.md`),
      renderStudy(manifest.title, studies, merged.evidence, [...warnings]),
    );
  } catch (caught) {
    status = "failed";
    error =
      caught instanceof SyntaxError
        ? "Model response was not valid JSON"
        : caught instanceof Error
          ? caught.message
          : "Provider failure"; /* Error text contains no raw responses or URLs. */
  }
  const run = {
    runId,
    provider,
    model:
      provider === "ollama"
        ? process.env.PANOPTO_LOCAL_TEST_MODEL || "qwen2.5:0.5b"
        : process.env.PANOPTO_CODEX_TEST_MODEL || "CLI default; not reported",
    status,
    error,
    localOutputCap: provider === "ollama" ? localCap : undefined,
    calls,
    cacheHits,
    wallSeconds: (performance.now() - started) / 1000,
    usage,
    usageComplete: usage.length === calls,
  };
  report.runs.push(run);
  await appendFile(
    path.join(output, "usage-ledger.jsonl"),
    JSON.stringify(run) + "\n",
  );
  await writeFile(
    path.join(output, `metrics-${runId}.json`),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    path.join(output, "metrics.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    provider +
      " comparison " +
      status +
      "; calls=" +
      calls +
      " cacheHits=" +
      cacheHits,
  );
}
console.log("Comparison results:", output);
