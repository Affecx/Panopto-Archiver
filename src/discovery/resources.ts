import type { Kind, Resource } from "../types";
function safeUrl(value: string, base: string) {
  try {
    const u = new URL(value, base);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return;
  }
}
export function links(doc: Document, base: string): Resource[] {
  return [...doc.querySelectorAll<HTMLAnchorElement>("a[download]")].flatMap(
    (a, i) => {
      const url = safeUrl(a.getAttribute("href") || "", base);
      if (!url) return [];
      const ext =
        new URL(url).pathname.split(".").pop()?.toLowerCase() || "bin";
      const kind: Kind = /^(mp4|webm|mov)$/.test(ext)
        ? "video"
        : /^(mp3|m4a|wav|ogg)$/.test(ext)
          ? "audio"
          : /^(vtt|srt)$/.test(ext) ||
              (ext === "txt" &&
                /transcript|caption/i.test(a.download || a.textContent || ""))
            ? "captions"
            : /^(jpg|png|jpeg|pptx|pdf)$/.test(ext)
              ? "slides"
              : "attachment";
      const unsupported = /^(m3u8|mpd)$/.test(ext);
      return [
        {
          id: `link-${i}`,
          kind,
          name: a.download || a.textContent?.trim() || `${kind}.${ext}`,
          format: ext,
          url,
          language: a.hreflang || undefined,
          status: unsupported ? "unsupported" : "available",
          reason: unsupported
            ? "Streaming manifests are not exported. Ask the owner for a downloadable file."
            : undefined,
        } satisfies Resource,
      ];
    },
  );
}
export function media(
  doc: Document,
  base: string,
  downloads: Resource[],
): Resource[] {
  const seen = new Set<string>();
  return [
    ...doc.querySelectorAll<HTMLMediaElement>(
      "video,audio,video source[src],audio source[src],track[src]",
    ),
  ].flatMap((el, i) => {
    const raw = el.currentSrc || el.getAttribute("src") || "";
    // A source child is the evidence when its parent has no current source yet.
    if (!raw && el.querySelector("source[src]")) return [];
    const url = raw ? safeUrl(raw, base) : undefined;
    if (url && downloads.some((r) => r.url === url)) return [];
    if (raw && seen.has(raw)) return [];
    if (raw) seen.add(raw);
    const isTrack = el.tagName === "TRACK";
    const kind: Kind = isTrack
      ? el.getAttribute("kind") === "chapters"
        ? "chapters"
        : "captions"
      : el.tagName === "AUDIO" || el.closest("audio")
        ? "audio"
        : "video";
    const browserManaged = raw.startsWith("blob:") || (!raw && !isTrack);
    const extension = url
      ? new URL(url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase()
      : undefined;
    return [
      {
        id: `playback-${i}`,
        kind,
        name: isTrack ? `Playback ${kind}` : `Playback ${kind} stream`,
        format: browserManaged ? "browser-managed" : extension || "unknown",
        language: isTrack ? el.getAttribute("srclang") || undefined : undefined,
        status: "restricted",
        reason: browserManaged
          ? "A browser-managed player was detected. No permitted download was identified; this adapter cannot export its playback buffer."
          : "Playback access does not establish export permission. No explicit download link found.",
      } satisfies Resource,
    ];
  });
}
export function chapters(doc: Document): Resource[] {
  // Standard HTML chapter tracks are reported by the media adapter; no proprietary schema is assumed.
  return [...doc.querySelectorAll('track[kind="chapters"]')].length
    ? [
        {
          id: "chapter-notice",
          kind: "chapters",
          name: "Chapter track",
          format: "vtt",
          status: "restricted",
          reason: "Chapter track requires an explicit download link.",
        },
      ]
    : [];
}
