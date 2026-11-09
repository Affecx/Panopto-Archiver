import { it, expect } from "vitest";
import { networkResources, playbackCandidate } from "../src/network";
import { loadedCaptionResources } from "../src/browser-captions";
import {
  renditionResources,
  attributes,
  inspectRenditions,
} from "../src/renditions";
const base = "https://example.com/video/master.m3u8?secret=private";
const master =
  '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English, stereo",LANGUAGE="en",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nvideo.m3u8';
it.each([
  ["m4a", "audio"],
  ["mp3", "audio"],
  ["aac", "audio"],
  ["vtt", "captions"],
  ["srt", "captions"],
])("discovers and classifies %s as %s", (ext, kind) => {
  const url = `https://example.com/resource.${ext}?secret=x`;
  expect(playbackCandidate(url)).toBe(true);
  expect(networkResources([url])[0]?.kind).toBe(kind);
});
it("parses quoted HLS attribute commas and separate tracks", () => {
  expect(attributes('NAME="English, stereo",TYPE=AUDIO').NAME).toBe(
    "English, stereo",
  );
  const tracks = renditionResources(master, base, "network-1");
  expect(tracks.map((r) => r.kind)).toEqual(["audio", "video"]);
  expect(tracks[0]?.language).toBe("en");
  expect(tracks[0]?.url).toBe("https://example.com/video/audio.m3u8");
});
it("does not expose encrypted rendition playlists", () =>
  expect(
    renditionResources(
      master + '\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"',
      base,
      "x",
    ),
  ).toEqual([]));
it("preserves a parent candidate when inspection is denied", async () => {
  const tracks = networkResources([base]);
  const result = await inspectRenditions(
    tracks,
    async () => new Response("", { status: 403 }),
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.status).toBe("available");
});
it("expands separate tracks without trying to mux the parent", async () => {
  const result = await inspectRenditions(
    networkResources([base]),
    async () => new Response(master),
  );
  expect(result).toHaveLength(3);
  expect(result[0]?.status).toBe("unsupported");
  expect(result[1]?.kind).toBe("audio");
});
it("exports loaded browser cue timestamps and warns about incomplete snapshots", () => {
  const doc = new DOMParser().parseFromString("<video></video>", "text/html");
  Object.defineProperty(doc.querySelector("video")!, "textTracks", {
    value: [
      {
        kind: "captions",
        language: "en",
        cues: [{ startTime: 1.25, endTime: 3.5, text: "Existing caption" }],
      },
    ],
  });
  const tracks = loadedCaptionResources(doc);
  expect(tracks[0]?.data).toContain("00:00:01.250 --> 00:00:03.500");
  expect(tracks[0]?.reason).toContain("may be incomplete");
});
it("reports unloaded tracks without generating fabricated captions", () => {
  const doc = new DOMParser().parseFromString("<video></video>", "text/html");
  Object.defineProperty(doc.querySelector("video")!, "textTracks", {
    value: [{ kind: "captions", cues: null }],
  });
  expect(loadedCaptionResources(doc)[0]).toMatchObject({
    status: "unsupported",
    data: undefined,
  });
});
