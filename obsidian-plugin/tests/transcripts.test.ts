import { it, expect, vi } from "vitest";
import { mergeTranscripts } from "../src/transcripts";
import { ollamaChat } from "../src/model";
it("deduplicates matching panel snapshots without dropping a repeated statement at a different time", () => {
  const text = "Retry\nSame statement.\n0:01\nCancel\nSame statement.\n0:10";
  const result = mergeTranscripts([
    { text, source: "one.txt", panelSnapshot: true },
    { text, source: "two.txt", panelSnapshot: true },
  ]);
  expect(result.evidence).toHaveLength(2);
  expect(result.evidence[0]?.source).toContain("0:01");
  expect(result.evidence[1]?.source).toContain("0:10");
  expect(result.duplicates).toBe(2);
  expect(result.cleanBytes).toBeLessThan(result.rawBytes);
});
it("tracks returned local tokens and nanosecond timings", async () => {
  const metrics = vi.fn();
  const chat = ollamaChat(
    "http://localhost:11434",
    "test",
    async () => ({
      model: "test",
      message: { content: "{}" },
      prompt_eval_count: 123,
      eval_count: 45,
      total_duration: 4e9,
      load_duration: 1e9,
      prompt_eval_duration: 1e9,
      eval_duration: 2e9,
      done_reason: "stop",
    }),
    1000,
    metrics,
  );
  await chat("system", "data");
  expect(metrics).toHaveBeenCalledWith({
    model: "test",
    input: 123,
    cached: 0,
    output: 45,
    totalSeconds: 4,
    loadSeconds: 1,
    promptSeconds: 1,
    generationSeconds: 2,
    doneReason: "stop",
  });
});
it("reports a truncated local response and does not silently retry", async () => {
  const request = vi.fn(async () => ({
    message: { content: '{"incomplete":' },
    done_reason: "length",
    eval_count: 100,
  }));
  await expect(
    ollamaChat("http://localhost:11434", "test", request)("system", "data"),
  ).rejects.toThrow("truncated");
  expect(request).toHaveBeenCalledTimes(1);
});
