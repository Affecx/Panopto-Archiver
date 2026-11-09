import { spawn } from "node:child_process";
import { realpath, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  renderLearningPage,
  sourceTime,
  localAsset,
  type ReferenceMedia,
} from "./learning";
import type { Evidence, Study } from "./study";
export type PrepareReferences = (options: {
  folder: string;
  anchors: number[];
  ffmpeg: string;
  ffprobe: string;
  evidence?: Evidence[];
}) => Promise<ReferenceMedia>;
export function referenceHelper(python: string): PrepareReferences {
  return async (options) =>
    new Promise((resolve, reject) => {
      const child = spawn(python, ["-m", "panopto_archiver.learning_media"], {
        stdio: "pipe",
        shell: false,
        windowsHide: true,
      });
      let text = "",
        settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(
          new Error(
            "Reference media preparation failed. Check local FFmpeg paths and archive files.",
          ),
        );
      };
      const timer = setTimeout(fail, 300000);
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.stderr.on("data", () => {});
      child.stdout.on("data", (data: Buffer) => {
        text += data.toString("utf8");
        if (text.length > 2 * 1024 * 1024) fail();
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          fail();
          return;
        }
        try {
          const result = JSON.parse(text) as ReferenceMedia;
          if (
            !Array.isArray(result.feeds) ||
            !Array.isArray(result.frames) ||
            !Array.isArray(result.warnings)
          )
            throw new Error();
          settled = true;
          clearTimeout(timer);
          resolve(result);
        } catch {
          fail();
        }
      });
      const { evidence: _evidence, ...request } = options;
      child.stdin.end(JSON.stringify(request) + "\n");
    });
}
async function inside(root: string, file: string) {
  const [base, target] = await Promise.all([realpath(root), realpath(file)]);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Reference asset is outside the archive");
  return target;
}
export async function exportLearningPage(
  options: {
    folder: string;
    title: string;
    studies: Study[];
    evidence: Evidence[];
    warnings: string[];
    ffmpeg: string;
    ffprobe: string;
  },
  prepare: PrepareReferences,
): Promise<string> {
  const root = await realpath(options.folder);
  const cited = new Set(
    options.studies.flatMap((s) =>
      [...s.takeaways, ...s.examples, ...(s.lessons ?? [])].flatMap(
        (t) => t.evidence,
      ),
    ),
  );
  const evidence = options.evidence.filter((e) => cited.has(e.id));
  const anchors = evidence
    .map(sourceTime)
    .filter((n): n is number => n !== undefined);
  const media = await prepare({
    folder: root,
    anchors,
    ffmpeg: options.ffmpeg,
    ffprobe: options.ffprobe,
    evidence,
  });
  const learning = path.join(root, "learning");
  await mkdir(learning, { recursive: true });
  if ((await inside(root, learning)) !== learning)
    throw new Error("Learning output folder cannot be a symbolic link");
  for (const feed of media.feeds) {
    localAsset(feed.path);
    await inside(root, path.join(root, feed.path));
  }
  for (const frame of media.frames) {
    localAsset(frame.path);
    const base = frame.archiveRelative ? root : learning;
    await inside(base, path.join(base, frame.path));
  }
  const html = renderLearningPage(
    options.title,
    options.studies,
    options.evidence,
    media,
    options.warnings,
  );
  // Preserve earlier pages, including answers associated with their original content.
  for (let n = 1; ; n++) {
    const target = path.join(
      learning,
      n === 1 ? "index.html" : `index-${n}.html`,
    );
    try {
      await writeFile(target, html, { flag: "wx" });
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
