import type { Resource } from "./types";
export function playbackCandidate(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      /\.(m3u8|mp4|webm|mpd|m4a|mp3|aac|wav|ogg|opus|vtt|srt)$/i.test(
        u.pathname,
      )
    );
  } catch {
    return false;
  }
}
export function networkResources(urls: string[]): Resource[] {
  return [...new Set(urls)]
    .filter(playbackCandidate)
    .slice(0, 24)
    .map((url, i) => {
      const ext = new URL(url).pathname.split(".").pop()!.toLowerCase();
      return {
        id: `network-${i}`,
        kind: /^(m4a|mp3|aac|wav|ogg|opus)$/.test(ext)
          ? "audio"
          : /^(vtt|srt)$/.test(ext)
            ? "captions"
            : "video",
        name: `${/^(m4a|mp3|aac|wav|ogg|opus)$/.test(ext) ? "audio" : /^(vtt|srt)$/.test(ext) ? "captions" : "playback"}_${i + 1}.${ext === "m3u8" ? "ts" : ext}`,
        format: ext === "m3u8" ? "hls" : ext,
        url,
        status: ext === "mpd" ? "unsupported" : "available",
        reason:
          ext === "mpd"
            ? "DASH assembly is not supported."
            : ext === "m3u8"
              ? "Unencrypted HLS VOD only; output is MPEG-TS video. Encryption and unsupported layouts are rejected at export."
              : "Network-observed file. Export only recordings you are authorised to archive.",
      };
    });
}
