import { timestamp } from "./captions";
import type { Resource } from "./types";
/** Snapshot only cues already provided by the browser. Never enable or alter tracks. */
export function loadedCaptionResources(doc: Document): Resource[] {
  const resources: Resource[] = [];
  for (const media of doc.querySelectorAll<HTMLMediaElement>("video,audio")) {
    for (const track of Array.from(media.textTracks || [])) {
      if (!["captions", "subtitles"].includes(track.kind)) continue;
      const cues = Array.from(track.cues || []).filter(
        (cue): cue is VTTCue =>
          "text" in cue &&
          Number.isFinite(cue.startTime) &&
          Number.isFinite(cue.endTime) &&
          cue.endTime >= cue.startTime,
      );
      const index = resources.length + 1;
      resources.push({
        id: `loaded-caption-${index}`,
        kind: "captions",
        format: "vtt",
        name: `loaded_captions_${index}.vtt`,
        language: track.language || undefined,
        status: cues.length ? "available" : "unsupported",
        data: cues.length
          ? "WEBVTT\n\n" +
            cues
              .map(
                (c) =>
                  `${timestamp(c.startTime)} --> ${timestamp(c.endTime)}\n${c.text}\n`,
              )
              .join("\n")
          : undefined,
        reason: cues.length
          ? "Snapshot of loaded browser cues only; may be incomplete. Original cue timing is preserved."
          : "Browser caption track found, but no cues are loaded. Enable captions in the player, then find playback streams again.",
      });
    }
  }
  return resources;
}
