import { ZipWriter, BlobWriter, BlobReader } from "@zip.js/zip.js";
import type { Resource, Session, Outcome } from "./types";
import { hlsStream, HlsError } from "./hls";
import { parseCaptions, srt } from "./captions";
export function filename(s: string): string {
  const clean =
    s
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 120) || "Lecture";
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)
    ? `_${clean}`
    : clean;
}
export function selectedResources(session: Session, ids: string[]): Resource[] {
  return session.resources.filter(
    (r) => ids.includes(r.id) && r.status === "available",
  );
}
export function manifest(session: Session, outcomes: Outcome[]) {
  return {
    schemaVersion: 1,
    session: {
      id: session.id,
      title: session.title,
      duration: session.duration,
    },
    resources: session.resources.map(({ url: _, data: __, ...r }) => ({
      ...r,
      outcome: outcomes.find((o) => o.id === r.id) || {
        status: "skipped",
        files: [],
      },
    })),
  };
}
export interface Sink {
  write(path: string, blob: Blob): Promise<void>;
  remote?(path: string, url: string): Promise<void>;
  stream?(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
}
const directories = {
  video: "media",
  audio: "media",
  captions: "transcripts",
  slides: "slides",
  attachment: "attachments",
  chapters: "metadata",
};
export async function exportSession(
  session: Session,
  ids: string[],
  sink: Sink,
  progress: (id: string, message: string) => void,
  fetcher: typeof fetch = fetch,
) {
  const outcomes: Outcome[] = [];
  let index = 0;
  for (const r of selectedResources(session, ids)) {
    const files: string[] = [];
    try {
      progress(r.id, "Downloading…");
      const path = `${directories[r.kind]}/${String(++index).padStart(3, "0")}_${filename(r.name)}`;
      if (r.format === "hls" && r.url) {
        const stream = await hlsStream(
          r.url,
          (message) => progress(r.id, message),
          fetcher,
        );
        if (sink.stream) await sink.stream(path, stream);
        else {
          const reader = stream.getReader();
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          let size = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 128 * 1024 * 1024)
                throw new HlsError(
                  "Assembled video exceeds 128 MiB; use streaming ZIP",
                );
              chunks.push(new Uint8Array(value));
            }
          } finally {
            await reader.cancel();
          }
          await sink.write(path, new Blob(chunks, { type: "video/mp2t" }));
        }
        files.push(path);
        outcomes.push({ id: r.id, status: "success", files });
        progress(r.id, "Exported");
        continue;
      }
      if (r.url && r.kind !== "captions" && sink.remote) {
        await sink.remote(path, r.url);
        files.push(path);
        outcomes.push({ id: r.id, status: "success", files });
        progress(r.id, "Exported");
        continue;
      }
      let blob: Blob;
      if (r.data !== undefined) blob = new Blob([r.data]);
      else {
        if (!r.url) throw new Error("Missing resource URL");
        const response = await fetcher(r.url, {
          credentials: "include",
          redirect: "error",
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (response.headers.get("content-type")?.includes("text/html"))
          throw new Error("Server returned a sign-in page");
        if (r.kind !== "captions" && sink.stream && response.body) {
          await sink.stream(path, response.body);
          files.push(path);
          outcomes.push({ id: r.id, status: "success", files });
          progress(r.id, "Exported");
          continue;
        }
        const limit =
          r.kind === "captions" ? 10 * 1024 * 1024 : 128 * 1024 * 1024;
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty response");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let total = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > limit)
              throw new Error(
                "Resource too large for buffered export; use Folder",
              );
            chunks.push(new Uint8Array(value));
          }
        } finally {
          await reader.cancel();
        }
        blob = new Blob(chunks);
      }
      await sink.write(path, blob);
      files.push(path);
      if (r.kind === "captions" && /^(srt|vtt)$/.test(r.format)) {
        const cues = parseCaptions(await blob.text());
        if (!cues.length)
          throw new Error("No timed cues found; original preserved");
        const stem = path.replace(/\.[^.]+$/, "");
        for (const [ext, content] of [
          ["txt", cues.map((c) => c.text).join("\n")],
          ["json", JSON.stringify(cues, null, 2)],
          ["srt", srt(cues)],
        ]) {
          if (`${stem}.${ext}` === path) continue;
          await sink.write(`${stem}.${ext}`, new Blob([content!]));
          files.push(`${stem}.${ext}`);
        }
      }
      outcomes.push({ id: r.id, status: "success", files });
      progress(r.id, "Exported");
    } catch (error) {
      const reason = error instanceof HlsError ? error.message : undefined;
      outcomes.push({
        id: r.id,
        status: "failed",
        files,
        error:
          reason ||
          "Download or conversion failed. Check access, network and format; retry from the lecture.",
      });
      progress(r.id, reason || "Failed — retry available");
    }
  }
  await sink.write(
    "metadata/session.json",
    new Blob([
      JSON.stringify(
        { id: session.id, title: session.title, duration: session.duration },
        null,
        2,
      ),
    ]),
  );
  await sink.write(
    "metadata/resources.json",
    new Blob([JSON.stringify(manifest(session, outcomes), null, 2)]),
  );
  await sink.write(
    "README.md",
    new Blob([
      `# ${session.title}\n\nExported with Panopto Archiver. See metadata/resources.json for omissions and failures.\n`,
    ]),
  );
  return outcomes;
}
export function zipSink() {
  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
  });
  return {
    write: async (path: string, blob: Blob) => {
      await writer.add(path, new BlobReader(blob));
    },
    close: () => writer.close(),
  };
}

export function streamingZipSink(stream: WritableStream<Uint8Array>) {
  const writer = new ZipWriter(stream, { useWebWorkers: false });
  return {
    write: async (path: string, blob: Blob) => {
      await writer.add(path, new BlobReader(blob));
    },
    stream: async (path: string, body: ReadableStream<Uint8Array>) => {
      await writer.add(path, body);
    },
    close: async () => {
      await writer.close();
    },
  };
}
