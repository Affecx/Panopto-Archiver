import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { destinationPath } from "./destination";

export interface ContextFile {
  path: string;
  text: string;
}
export interface ContextScope {
  folder: string;
  file?: string;
}
export function contextScope(
  selected: string,
  isFolder: boolean,
  includeParent: boolean,
): ContextScope {
  const normalized = destinationPath(selected);
  if (isFolder) return { folder: normalized };
  return {
    folder: path.posix.dirname(normalized).replace(/^\.$/, ""),
    ...(includeParent ? {} : { file: normalized }),
  };
}
export function contextPath(value: string): string {
  if (
    !value ||
    !destinationPath(value) ||
    /[<>?"*|\x7f]/.test(value) ||
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(value) ||
    /(?:^|\/)(?:id_(?:rsa|ed25519)|credentials\.json|storage[-_]?state\.json)$/i.test(
      value,
    )
  )
    throw new Error("The context includes an unsupported or protected path");
  return value;
}

export async function existingPath(root: string, relative: string) {
  const target = path.join(root, relative ? contextPath(relative) : "");
  if ((await realpath(target)) !== target)
    throw new Error(
      "Linked or redirected files are outside the supported context",
    );
  return target;
}

export async function listContextDirectory(root: string, folder: string) {
  const entries = await readdir(await existingPath(root, folder), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => {
      if (!entry.isDirectory() && !entry.isFile()) return false;
      try {
        contextPath(folder ? folder + "/" + entry.name : entry.name);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "folder" : "file",
    }));
}

export async function contextFiles(
  root: string,
  scope: ContextScope,
  skipDirectory: (name: string) => boolean = () => false,
): Promise<string[]> {
  if (scope.file) return [contextPath(scope.file)];
  const files: string[] = [];
  async function walk(relative: string) {
    const directory = await existingPath(root, relative);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? relative + "/" + entry.name : entry.name;
      try {
        contextPath(child);
      } catch {
        continue;
      }
      if (entry.isDirectory() && !skipDirectory(entry.name)) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(scope.folder);
  return files;
}

export async function readContextText(
  root: string,
  relative: string,
  limit: number,
): Promise<string | undefined> {
  const file = await open(
    await existingPath(root, relative),
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) return undefined;
    const size = Math.min(stat.size, limit + 1);
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const result = await file.read(buffer, read, size - read, read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, read),
        { stream: stat.size > limit },
      );
    } catch {
      return undefined;
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return undefined;
    if (stat.size > limit)
      throw new Error(
        "Context exceeds the input limit. Select a smaller context or raise the input limit.",
      );
    return text;
  } finally {
    await file.close();
  }
}

export async function checkNewContextFile(root: string, relative: string) {
  const parent = path.posix.dirname(relative).replace(/^\.$/, "");
  const target = path.join(
    await existingPath(root, parent),
    path.posix.basename(contextPath(relative)),
  );
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return target;
    throw error;
  }
  throw new Error("A proposed new file already exists. Run the macro again.");
}
export async function createContextFile(
  root: string,
  relative: string,
  text: string,
) {
  await writeFile(await checkNewContextFile(root, relative), text, {
    flag: "wx",
  });
}
