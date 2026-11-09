import { it, expect, vi } from "vitest";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { ollamaChat } from "../src/model";
import {
  codexChat,
  codexArgs,
  codexEnvironment,
  type CommandRunner,
} from "../src/codex";
it("uses loopback Ollama with output limits", async () => {
  const request = vi.fn(async () => ({
    message: { content: '{"summary":"test"}' },
  }));
  expect(
    await ollamaChat(
      "http://127.0.0.1:11434",
      "local-model",
      request,
      800,
    )("rules", "data"),
  ).toContain("summary");
  expect(request).toHaveBeenCalledWith(
    "http://127.0.0.1:11434/api/chat",
    expect.objectContaining({
      stream: false,
      options: { temperature: 0.2, num_predict: 800, num_ctx: 8192 },
    }),
  );
  expect(() => ollamaChat("https://example.com", "model", request)).toThrow();
});
it("uses signed-in Codex with read-only ephemeral execution, stdin input and usage extraction", async () => {
  let directory = "";
  const calls: { args: string[]; input: string }[] = [];
  const runner: CommandRunner = async (_binary, args, input, cwd) => {
    calls.push({ args, input });
    directory = cwd;
    if (args[0] === "login")
      return { stdout: "", stderr: "Logged in using ChatGPT" };
    await writeFile(
      args[args.indexOf("--output-last-message") + 1]!,
      '{"summary":"test"}',
    );
    return {
      stdout: JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 123,
          cached_input_tokens: 20,
          output_tokens: 45,
        },
      }),
      stderr: "",
    };
  };
  const usage = vi.fn();
  expect(
    await codexChat(
      "/path/to/codex",
      "",
      usage,
      runner,
    )("rules", "fictional data"),
  ).toContain("summary");
  expect(calls).toHaveLength(2);
  expect(calls[1]!.input).toContain("fictional data");
  expect(calls[1]!.args.join(" ")).not.toContain("fictional data");
  expect(calls[1]!.args).toEqual(
    expect.arrayContaining([
      "--ephemeral",
      "--ignore-user-config",
      "read-only",
      "shell_tool",
      "--output-schema",
    ]),
  );
  expect(usage).toHaveBeenCalledWith({ input: 123, cached: 20, output: 45 });
  await expect(access(directory)).rejects.toThrow();
});
it("refuses API-key login rather than silently using paid API authentication", async () => {
  const runner = vi.fn(async () => ({
    stdout: "Logged in using an API key",
    stderr: "",
  }));
  await expect(
    codexChat("codex", "", () => {}, runner)("rules", "data"),
  ).rejects.toThrow("ChatGPT");
  expect(runner).toHaveBeenCalledTimes(1);
});
it("removes API-key environment overrides and never uses sandbox bypass flags", () => {
  expect(
    codexEnvironment({
      PATH: "/bin",
      OPENAI_API_KEY: "secret",
      CODEX_API_KEY: "secret",
    }),
  ).toEqual({ PATH: "/bin" });
  const args = codexArgs("model", "schema", "output");
  expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(args).toContain("--model");
});
