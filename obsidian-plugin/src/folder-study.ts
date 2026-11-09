import path from "node:path";
import { contextFiles, contextPath, readContextText } from "./context";
import { mergeTranscripts } from "./transcripts";
import type { Evidence } from "./study";
import type { PrepareReferences } from "./learning-export";
import { sourceTime, type ReferenceMedia } from "./learning";

interface LocalArchive {
  relative: string;
  title: string;
}
interface ArchiveResource {
  kind?: string;
  outcome?: string;
  source?: string;
  files?: unknown[];
}
export async function folderSources(
  root: string,
  folder: string,
  limit: number,
) {
  const files = await contextFiles(
    root,
    { folder },
    (name) => name === "learning" || name === "Generated Cache",
  );
  const evidence: Evidence[] = [];
  const inputs = new Set<string>();
  const archives: LocalArchive[] = [];
  const warnings = new Set<string>();
  let remaining = limit;
  const add = (items: Evidence[], input?: string) => {
    for (const item of items) {
      if (!item.text.trim()) continue;
      remaining -= Buffer.byteLength(item.text);
      if (remaining < 0)
        throw new Error(
          "Folder notes and captions exceed the input limit. Select a smaller folder or raise the input limit.",
        );
      evidence.push({ ...item, id: "E" + (evidence.length + 1) });
      if (input) inputs.add(input);
    }
  };
  for (const file of files) {
    if (!/(?:^|\/)metadata\/resources\.json$/.test(file)) continue;
    let manifest: {
      version?: number;
      title?: string;
      partial?: boolean;
      resources?: ArchiveResource[];
    } | null;
    try {
      manifest = JSON.parse(
        (await readContextText(root, file, 2 * 1024 * 1024)) ?? "null",
      );
    } catch {
      warnings.add("A resource manifest could not be read.");
      continue;
    }
    if (manifest?.version !== 2 || !Array.isArray(manifest.resources)) continue;
    const relative = path.posix
      .dirname(path.posix.dirname(file))
      .replace(/^\.$/, "");
    const title =
      typeof manifest.title === "string" && manifest.title.trim()
        ? manifest.title
        : path.posix.basename(relative) || "Lecture";
    archives.push({ relative, title });
    const recording = "lecture-" + archives.length;
    if (manifest.partial) warnings.add(`The archive for ${title} is partial.`);
    const entries: { text: string; source: string; panelSnapshot: boolean }[] =
      [];
    for (const item of manifest.resources) {
      if (item?.kind !== "captions" || !Array.isArray(item.files)) continue;
      for (const entry of item.files) {
        if (typeof entry !== "string" || !/^transcripts\/.+\.txt$/i.test(entry))
          continue;
        let captionFile: string;
        try {
          captionFile = relative
            ? relative + "/" + contextPath(entry)
            : contextPath(entry);
        } catch {
          warnings.add("An invalid archive caption path was skipped.");
          continue;
        }
        if (!files.includes(captionFile)) {
          warnings.add("An archived caption file was missing or linked.");
          continue;
        }
        const text = await readContextText(root, captionFile, limit);
        if (!text?.trim()) continue;
        inputs.add(captionFile);
        entries.push({
          text,
          source: captionFile,
          panelSnapshot: item.source === "semantic caption panel snapshot",
        });
        if (item.source === "semantic caption panel snapshot")
          warnings.add("Rendered caption snapshots may be incomplete.");
      }
    }
    add(
      mergeTranscripts(entries).evidence.map((item) => ({
        ...item,
        kind: "caption",
        recording,
      })),
    );
  }
  for (const file of files) {
    if (
      !/\.md$/i.test(file) ||
      archives.some(
        (archive) =>
          file ===
          (archive.relative ? archive.relative + "/" : "") + "README.md",
      )
    )
      continue;
    const text = await readContextText(root, file, remaining);
    if (text)
      add(
        (text.match(/[\s\S]{1,3000}/g) ?? []).map((part) => ({
          id: "",
          kind: "note",
          source: file,
          text: part,
        })),
        file,
      );
  }
  return { evidence, archives, inputs: [...inputs], warnings: [...warnings] };
}

export function folderReferences(
  archives: LocalArchive[],
  folder: string,
  prepare: PrepareReferences,
): PrepareReferences {
  return async (options) => {
    const result: ReferenceMedia = {
      version: 1,
      feeds: [],
      frames: [],
      warnings: [],
      sampling:
        "Recorded frames are sampled. Use the original recordings for exact moments.",
    };
    for (const [index, archive] of archives.entries()) {
      const recording = "lecture-" + (index + 1);
      const anchors = (options.evidence ?? [])
        .filter((item) => item.recording === recording)
        .map(sourceTime)
        .filter((at): at is number => at !== undefined);
      const relative = path.posix.relative(folder, archive.relative);
      const prefix = relative ? relative + "/" : "";
      let media: ReferenceMedia;
      try {
        media = await prepare({
          ...options,
          folder: path.join(options.folder, relative),
          anchors,
          evidence: undefined,
        });
      } catch {
        result.warnings.push(
          `Could not prepare local recording references for ${archive.title}.`,
        );
        continue;
      }
      result.feeds.push(
        ...media.feeds.map((feed) => ({
          ...feed,
          recording,
          recordingTitle: archive.title,
          id: recording + "-" + feed.id,
          label: archive.title + " · " + feed.label,
          path: prefix + feed.path,
        })),
      );
      result.frames.push(
        ...media.frames.map((frame) => ({
          ...frame,
          id: recording + "-" + frame.id,
          feed: recording + "-" + frame.feed,
          path: prefix + "learning/" + frame.path,
          archiveRelative: true,
        })),
      );
      result.warnings.push(
        ...media.warnings.map((warning) => archive.title + " · " + warning),
      );
    }
    return result;
  };
}
