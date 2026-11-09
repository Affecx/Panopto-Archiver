import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
export interface ArchiveResult {
  type: "result";
  folder: string;
  title: string;
  partial: boolean;
  transcripts: { path: string; warning: string; source?: string }[];
}
export type BridgeEvent =
  | ArchiveResult
  | { type: "login"; message: string }
  | { type: "progress"; message: string }
  | { type: "error"; message: string };
export function archiveBridge(
  python: string,
  input: object,
  onEvent: (event: BridgeEvent) => void,
): {
  continueLogin: () => void;
  cancel: () => void;
  done: Promise<ArchiveResult>;
} {
  const child: ChildProcessWithoutNullStreams = spawn(
    python,
    ["-m", "panopto_archiver.bridge"],
    { stdio: "pipe", windowsHide: true, shell: false },
  );
  let buffer = "";
  let result: ArchiveResult | undefined;
  let settled = false;
  const done = new Promise<ArchiveResult>((resolve, reject) => {
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            "Local archiver failed. Check its setup and sign-in, then retry.",
          ),
        );
      }
    };
    child.on("error", fail);
    child.stderr.on("data", () => {
      /* Private helper details are deliberately not logged or shown. */
    });
    child.stdout.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      if (buffer.length > 2 * 1024 * 1024) {
        child.kill();
        fail();
        return;
      }
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line) as BridgeEvent;
          if (event.type === "result") result = event;
          onEvent(event);
        } catch {
          child.kill();
          fail();
          return;
        }
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0 && result) {
        settled = true;
        resolve(result);
      } else fail();
    });
  });
  child.stdin.write(JSON.stringify(input) + "\n");
  return {
    done,
    continueLogin: () =>
      child.stdin.write(JSON.stringify({ op: "continue" }) + "\n"),
    cancel: () => child.kill("SIGTERM"),
  };
}
