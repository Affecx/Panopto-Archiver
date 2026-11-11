import { expect, it, vi } from "vitest";
import { access, readFile } from "node:fs/promises";
import { claudeChat, claudeEnvironment } from "../src/claude";
import type { CommandRunner } from "../src/codex";
import { macroSchema } from "../src/macros";

it("uses Claude CLI sign-in, stdin and structured output for study and macro schemas", async () => {
  const calls: { args: string[]; input: string; cwd: string }[] = [];
  const runner: CommandRunner = async (_binary, args, input, cwd) => {
    calls.push({ args, input, cwd });
    if (args[0] === "auth")
      return {
        stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
        stderr: "",
      };
    expect(
      await readFile(args[args.indexOf("--system-prompt-file") + 1]!, "utf8"),
    ).toContain("fixture rules");
    expect(args).toEqual(
      expect.arrayContaining([
        "--print",
        "--safe-mode",
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-chrome",
      ]),
    );
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args.join(" ")).not.toContain("fictional source");
    return {
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: { summary: "Fictional result", edits: [] },
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 2,
        },
      }),
      stderr: "",
    };
  };
  const usage = vi.fn();
  const result = await claudeChat(
    "/bin/claude",
    "sonnet",
    usage,
    runner,
    macroSchema,
  )("fixture rules", "fictional source");
  expect(JSON.parse(result).summary).toBe("Fictional result");
  expect(calls).toHaveLength(2);
  expect(calls[0]!.args).toEqual(["auth", "status"]);
  expect(calls[1]!.input).toBe("fictional source");
  const args = calls[1]!.args;
  expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual(
    macroSchema(),
  );
  expect(usage).toHaveBeenCalledWith({ input: 16, cached: 4, output: 5 });
  await expect(access(calls[1]!.cwd)).rejects.toThrow();
  calls.length = 0;
  await claudeChat(
    "claude",
    "",
    usage,
    runner,
  )("fixture rules", "fictional source");
  expect(calls[1]!.args).not.toContain("--model");
  expect(
    JSON.parse(calls[1]!.args[calls[1]!.args.indexOf("--json-schema") + 1]!)
      .properties.summary,
  ).toEqual({ type: "string" });
});

it("rejects unsupported authentication, CLI errors and missing structured output", async () => {
  const auth = JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });
  const api = vi.fn(async () => ({
    stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
    stderr: "",
  }));
  await expect(
    claudeChat("claude", "", () => {}, api)("rules", "data"),
  ).rejects.toThrow("claude auth login");
  expect(api).toHaveBeenCalledTimes(1);
  for (const output of [
    "invalid",
    "null",
    JSON.stringify({ type: "result", subtype: "success", result: "{}" }),
    JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      structured_output: {},
    }),
  ]) {
    let directory = "";
    const runner: CommandRunner = async (_binary, args, _input, cwd) => {
      directory = cwd;
      return { stdout: args[0] === "auth" ? auth : output, stderr: "" };
    };
    await expect(
      claudeChat("claude", "", () => {}, runner)("rules", "data"),
    ).rejects.toThrow(/Claude/);
    await expect(access(directory)).rejects.toThrow();
  }
  expect(
    claudeEnvironment({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "fictional",
      ANTHROPIC_AUTH_TOKEN: "fictional",
      ANTHROPIC_BASE_URL: "https://example.invalid",
      CLAUDE_CODE_USE_VERTEX: "1",
    }),
  ).toEqual({ PATH: "/bin" });
});
