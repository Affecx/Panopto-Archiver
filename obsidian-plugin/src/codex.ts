import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Chat } from "./study";
import type { Usage } from "./model";
import { studySchema } from "./schema";
export type CommandRunner = (
  binary: string,
  args: string[],
  stdin: string,
  cwd: string,
  options?: {
    provider: string;
    env: NodeJS.ProcessEnv;
    signIn?: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;
export function codexEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}
export function codexArgs(
  model: string,
  schema: string,
  output: string,
  instructions?: string,
): string[] {
  return [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    "--output-schema",
    schema,
    "--output-last-message",
    output,
    "-c",
    'approval_policy="never"',
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    'web_search="disabled"',
    "-c",
    'model_reasoning_effort="low"',
    "--disable",
    "shell_tool",
    "--disable",
    "apps",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--disable",
    "skill_search",
    "--disable",
    "remote_plugin",
    ...(instructions
      ? ["-c", `model_instructions_file=${JSON.stringify(instructions)}`]
      : []),
    ...(model ? ["--model", model] : []),
    "-",
  ];
}
export const runCommand: CommandRunner = (binary, args, stdin, cwd, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: options?.env ?? codexEnvironment(),
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      finished = false;
    const fail = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      const events: Record<string, number> = {};
      for (const line of stdout.split("\n")) {
        try {
          const value = JSON.parse(line) as { type?: string };
          if (value.type && /^[a-z_.]+$/.test(value.type))
            events[value.type] = (events[value.type] || 0) + 1;
        } catch {}
      }
      reject(
        new Error(
          `${options?.provider ?? "Codex"} could not finish (${options?.signIn || args[0] === "login" ? "sign-in check" : "generation"}; received events: ${JSON.stringify(events)}). Check CLI access and usage limits. No automatic retry was made.`,
        ),
      );
    };
    const timer = setTimeout(
      fail,
      options?.signIn || args[0] === "login" ? 30000 : 300000,
    );
    child.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2 * 1024 * 1024) fail();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 512 * 1024) fail();
    });
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        fail();
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    child.stdin.on("error", fail);
    child.stdin.end(stdin);
  });
export function codexChat(
  binary: string,
  model: string,
  onUsage: (usage: Usage) => void,
  runner: CommandRunner = runCommand,
  schemaFor = studySchema,
): Chat {
  return async (system, user) => {
    if (!binary) throw new Error("Configure the Codex CLI executable first");
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "panopto-study-codex-"),
    );
    try {
      const status = await runner(binary, ["login", "status"], "", directory);
      if (
        !/logged in using chatgpt/i.test(status.stdout + "\n" + status.stderr)
      )
        throw new Error(
          "Sign into the Codex CLI with ChatGPT using codex login. API-key authentication is not used by this plugin.",
        );
      const schema = path.join(directory, "schema.json"),
        output = path.join(directory, "study.json"),
        instructions = path.join(directory, "instructions.txt");
      await writeFile(
        instructions,
        `${system}\nDo not use tools, read files, browse or execute code. Return only concise final JSON.`,
        { mode: 0o600 },
      );
      await writeFile(schema, JSON.stringify(schemaFor(user)), {
        mode: 0o600,
      });
      const response = await runner(
        binary,
        codexArgs(model, schema, output, instructions),
        user,
        directory,
      );
      for (const line of response.stdout.split("\n")) {
        try {
          const event = JSON.parse(line) as {
            type: string;
            usage?: {
              input_tokens?: number;
              cached_input_tokens?: number;
              output_tokens?: number;
            };
          };
          if (event.type === "turn.completed" && event.usage)
            onUsage({
              input: event.usage.input_tokens || 0,
              cached: event.usage.cached_input_tokens || 0,
              output: event.usage.output_tokens || 0,
            });
        } catch {}
      }
      const result = await readFile(output, "utf8");
      if (Buffer.byteLength(result) > 2 * 1024 * 1024)
        throw new Error("Codex output exceeds the safety limit");
      return result;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
