/** Strict subset of RFC 8216: complete, unencrypted MPEG-TS VOD. */
export class HlsError extends Error {}
function resolve(raw: string, base: string) {
  const u = new URL(raw, base);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new HlsError("Unsafe stream URL");
  return u.href;
}
export function parsePlaylist(
  raw: string,
  base: string,
): { variants: string[]; segments: string[] } {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new HlsError("Not an HLS playlist");
  if (
    lines.some(
      (l) =>
        /^#EXT-X-(KEY|SESSION-KEY):/.test(l) &&
        !/^#EXT-X-KEY:METHOD=NONE$/.test(l),
    )
  )
    throw new HlsError("Encrypted streams are not supported");
  if (
    lines.some((l) =>
      /^#EXT-X-(MAP|BYTERANGE|DISCONTINUITY|GAP|PART|SKIP|I-FRAMES-ONLY)/.test(
        l,
      ),
    )
  )
    throw new HlsError(
      "Fragmented MP4, byte ranges or discontinuous streams are not supported",
    );
  if (
    lines.some(
      (l) =>
        /^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(l) ||
        /^#EXT-X-STREAM-INF:.*AUDIO=/.test(l),
    )
  )
    throw new HlsError(
      "Separate audio renditions require muxing and are not supported",
    );
  const variants: string[] = [];
  const segments: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const next = lines[i + 1];
      if (!next || next.startsWith("#"))
        throw new HlsError("Malformed variant");
      variants.push(resolve(next, base));
      i++;
    } else if (!line.startsWith("#")) segments.push(resolve(line, base));
  }
  if (variants.length && segments.length) throw new HlsError("Mixed playlist");
  if (
    !variants.length &&
    (!lines.includes("#EXT-X-ENDLIST") || !segments.length)
  )
    throw new HlsError(
      "Only complete VOD playlists are supported; live or empty stream detected",
    );
  if (segments.length > 100000) throw new HlsError("Too many segments");
  return { variants, segments };
}
async function request(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    credentials: "include",
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new HlsError("Stream request denied or failed");
  if (response.headers.get("content-type")?.includes("text/html"))
    throw new HlsError("Stream returned a sign-in page");
  return response;
}
export async function hlsStream(
  url: string,
  progress: (message: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<ReadableStream<Uint8Array>> {
  let segments: string[] = [];
  for (let depth = 0; depth < 4; depth++) {
    const response = await request(url, fetcher);
    const reader = response.body?.getReader();
    if (!reader) throw new HlsError("Empty playlist");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new HlsError("Playlist too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const text = await new Blob(chunks.map((c) => new Uint8Array(c))).text();
    const playlist = parsePlaylist(text, url);
    if (playlist.variants.length) {
      url = playlist.variants[0]!;
      continue;
    }
    segments = playlist.segments;
    break;
  }
  if (!segments.length)
    throw new HlsError("Nested master playlist is unsupported");
  let index = 0;
  let active: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let segmentBytes = 0;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (!active) {
            if (index === segments.length) {
              controller.close();
              return;
            }
            const response = await request(segments[index]!, fetcher);
            active = response.body?.getReader();
            segmentBytes = 0;
            if (!active) throw new HlsError("Empty segment");
            progress(`Downloading segment ${index + 1}/${segments.length}`);
          }
          const { value, done } = await active.read();
          if (cancelled) return;
          if (done) {
            if (!segmentBytes || segmentBytes % 188 !== 0)
              throw new HlsError("Invalid MPEG-TS segment");
            active = undefined;
            index++;
            continue;
          }
          if (!segmentBytes && value[0] !== 0x47)
            throw new HlsError(
              "Expected MPEG-TS; this stream requires another format adapter",
            );
          segmentBytes += value.length;
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        await active?.cancel().catch(() => {});
        controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      await active?.cancel();
    },
  });
}
