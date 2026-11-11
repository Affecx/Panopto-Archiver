import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand, type CommandRunner } from "./codex";
import type { Chat } from "./study";
import type { Usage } from "./model";
import { studySchema } from "./schema";

export function claudeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SIMPLE",
  ])
    delete env[key];
  return env;
}

const runClaude: CommandRunner = (binary, args, stdin, cwd) =>
  runCommand(binary, args, stdin, cwd, {
    provider: "Claude",
    env: claudeEnvironment(),
    signIn: args[0] === "auth",
  });

export function claudeChat(
  binary: string,
  model: string,
  onUsage: (usage: Usage) => void,
  runner: CommandRunner = runClaude,
  schemaFor = studySchema,
): Chat {
  return async (system, user) => {
    if (!binary.trim())
      throw new Error("Configure the Claude CLI executable first");
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "panopto-study-claude-"),
    );
    try {
      const status = await runner(binary, ["auth", "status"], "", directory);
      let auth: { authMethod?: string; loggedIn?: boolean };
      try {
        auth = JSON.parse(status.stdout);
      } catch {
        throw new Error(
          "Could not check Claude CLI sign-in. Update Claude Code and run claude auth login.",
        );
      }
      if (
        auth?.loggedIn !== true ||
        !["claude.ai", "oauth_token"].includes(auth.authMethod ?? "")
      )
        throw new Error(
          "Sign into Claude Code with your Claude account using claude auth login.",
        );
      const instructions = path.join(directory, "instructions.txt");
      await writeFile(
        instructions,
        system + "\nReturn only the requested JSON. Use no tools.",
        { mode: 0o600 },
      );
      const response = await runner(
        binary,
        [
          "--print",
          "--safe-mode",
          "--no-session-persistence",
          "--no-chrome",
          "--tools",
          "",
          "--disallowedTools",
          "mcp__*",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--setting-sources",
          "",
          "--system-prompt-file",
          instructions,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(schemaFor(user)),
          ...(model ? ["--model", model] : []),
        ],
        user,
        directory,
      );
      let result: {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        structured_output?: unknown;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      try {
        result = JSON.parse(response.stdout);
      } catch {
        throw new Error(
          "Claude returned invalid JSON output. Check the installed CLI version.",
        );
      }
      if (result?.usage)
        onUsage({
          input:
            (result.usage.input_tokens ?? 0) +
            (result.usage.cache_read_input_tokens ?? 0) +
            (result.usage.cache_creation_input_tokens ?? 0),
          cached: result.usage.cache_read_input_tokens ?? 0,
          output: result.usage.output_tokens ?? 0,
        });
      if (
        !result ||
        result.type !== "result" ||
        result.is_error ||
        result.subtype !== "success" ||
        !result.structured_output ||
        typeof result.structured_output !== "object" ||
        Array.isArray(result.structured_output)
      )
        throw new Error(
          "Claude did not return structured output. Check CLI access, model availability and account limits.",
        );
      return JSON.stringify(result.structured_output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
