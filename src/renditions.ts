import type { Resource } from "./types";
/** RFC 8216 attribute list with quoted values (including commas). */
export function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    result[match[1]!] = match[2]!.replace(/^"|"$/g, "");
  }
  return result;
}
function safe(raw: string, base: string) {
  try {
    const u = new URL(raw, base);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return;
  }
}
export function renditionResources(
  raw: string,
  base: string,
  prefix: string,
): Resource[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (lines[0] !== "#EXTM3U") return [];
  if (
    lines.some(
      (l) =>
        /^#EXT-X-(KEY|SESSION-KEY):/.test(l) && l !== "#EXT-X-KEY:METHOD=NONE",
    )
  )
    return [];
  const result: Resource[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let kind: Resource["kind"];
    let uri: string | undefined;
    let language: string | undefined;
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = attributes(line.slice(13));
      if (!["AUDIO", "SUBTITLES"].includes(a.TYPE || "") || !a.URI) continue;
      kind = a.TYPE === "AUDIO" ? "audio" : "captions";
      uri = a.URI;
      language = a.LANGUAGE;
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      kind = "video";
      uri = lines[i + 1];
      if (!uri || uri.startsWith("#")) continue;
    } else continue;
    const url = safe(uri!, base);
    if (!url) continue;
    const caption = kind === "captions";
    result.push({
      id: `${prefix}-rendition-${result.length}`,
      kind,
      url,
      format: caption ? "hls-vtt" : "hls",
      name: `${kind}_rendition_${result.length + 1}.${caption ? "m3u8" : "ts"}`,
      language,
      status: caption ? "unsupported" : "available",
      reason: caption
        ? "Segmented WebVTT subtitles detected. Timestamp-map aware subtitle assembly is not supported yet."
        : "Separate HLS rendition; exported as its own MPEG-TS file. Not automatically muxed with other feeds. Encryption and unsupported segment formats are checked at export.",
    });
  }
  return result;
}
export async function inspectRenditions(
  resources: Resource[],
  fetcher: typeof fetch = fetch,
): Promise<Resource[]> {
  const additions: Resource[] = [];
  await Promise.all(
    resources
      .filter((r) => r.format === "hls" && r.url)
      .slice(0, 8)
      .map(async (resource) => {
        try {
          const response = await fetcher(resource.url!, {
            credentials: "include",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok || !response.body) return;
          const reader = response.body.getReader();
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          let size = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 2 * 1024 * 1024) return;
              chunks.push(new Uint8Array(value));
            }
          } finally {
            await reader.cancel();
          }
          const raw = await new Blob(chunks).text();
          const extra = renditionResources(raw, resource.url!, resource.id);
          // Do not duplicate ordinary variant-only master playlists; the assembler handles them.
          if (extra.some((r) => r.kind === "audio" || r.kind === "captions")) {
            additions.push(...extra);
            resource.status = "unsupported";
            resource.reason =
              "Master playlist has separate tracks. Select the individual audio/video renditions below; automatic muxing is not supported.";
          }
        } catch {
          /* Candidate remains visible so CDN permission can be granted and discovery retried. */
        }
      }),
  );
  return [...resources, ...additions];
}
