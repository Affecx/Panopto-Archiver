// @vitest-environment node
import { it, expect } from "vitest";
import { parsePlaylist, hlsStream } from "../src/hls";
import { networkResources, playbackCandidate } from "../src/network";
import { readFile } from "node:fs/promises";
const base = "https://example.com/recording/video.m3u8?secret=private";
const vod = "#EXTM3U\n#EXTINF:1,\npart00.ts\n#EXT-X-ENDLIST";
it("resolves relative segments without copying signed query credentials", () =>
  expect(parsePlaylist(vod, base).segments).toEqual([
    "https://example.com/recording/part00.ts",
  ]));
it.each([
  '#EXT-X-KEY:METHOD=AES-128,URI="secret"',
  '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="secret"',
  '#EXT-X-MAP:URI="init.mp4"',
  "#EXT-X-DISCONTINUITY",
  "#EXT-X-BYTERANGE:100@0",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a"',
])("rejects unsupported or encrypted layouts: %s", (tag) =>
  expect(() => parsePlaylist(vod + "\n" + tag, base)).toThrow(),
);
it("rejects live, invalid and malformed playlists", () => {
  expect(() =>
    parsePlaylist(vod.replace("#EXT-X-ENDLIST", ""), base),
  ).toThrow();
  expect(() => parsePlaylist("<html>login</html>", base)).toThrow();
  expect(() =>
    parsePlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1", base),
  ).toThrow();
});
it("follows a master and assembles real MPEG-TS bytes in order", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("master.m3u8"))
      return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8");
    const name = new URL(url).pathname.split("/").pop()!;
    return new Response(
      await readFile(new URL(`../mock/media/${name}`, import.meta.url)),
    );
  };
  const stream = await hlsStream(
    "https://example.com/master.m3u8",
    () => {},
    fetcher,
  );
  const blob = await new Response(stream).blob();
  expect(blob.size).toBeGreaterThan(188);
  expect(calls.filter((c) => c.endsWith(".ts"))).toHaveLength(4);
});
it("rejects denied segments and invalid transport bytes", async () => {
  for (const response of [
    new Response("", { status: 403 }),
    new Response("not ts"),
  ]) {
    const fetcher: typeof fetch = async (input) =>
      String(input).includes(".m3u8") ? new Response(vod) : response;
    const stream = await hlsStream(base, () => {}, fetcher);
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow();
  }
});
it("keeps network candidate names anonymous and filters unsafe URLs", () => {
  expect(playbackCandidate("blob:https://example.com/private")).toBe(false);
  expect(playbackCandidate("https://user:pass@example.com/video.mp4")).toBe(
    false,
  );
  const resources = networkResources([
    base,
    base,
    "https://example.com/live.mpd",
  ]);
  expect(resources).toHaveLength(2);
  expect(resources[0]?.name).toBe("playback_1.ts");
  expect(resources[1]?.status).toBe("unsupported");
});
