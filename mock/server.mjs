import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
export const scenarios = [
  "single",
  "dual",
  "multiple",
  "captions",
  "no-captions",
  "slides",
  "restricted",
  "malformed",
  "errors",
];
const caption =
  "WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nWelcome to fictional physics.\n";
export const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:4173");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname.startsWith("/hls/")) {
    if (url.pathname === "/hls/master.m3u8") {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000\nvideo.m3u8\n");
      return;
    }
    if (url.pathname === "/hls/tracks.m3u8") {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.end(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,AUDIO="audio",SUBTITLES="subs"\nvideo.m3u8\n',
      );
      return;
    }
    const name = url.pathname.slice(5);
    if (!/^((video|audio)\.m3u8|audio\.m4a|(part|audio)\d+\.ts)$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      name.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl",
    );
    res.end(readFileSync(new URL(`./media/${name}`, import.meta.url)));
    return;
  }
  if (url.pathname.startsWith("/files/")) {
    if (url.pathname.includes("error")) {
      res.writeHead(503).end("Temporary error");
      return;
    }
    if (url.pathname.endsWith(".vtt")) {
      res.setHeader("Content-Type", "text/vtt");
      res.end(caption);
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
      res.end("Fictional resource bytes");
    }
    return;
  }
  if (url.pathname === "/moodle") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><title>Fictional Moodle</title><iframe src="/Panopto/Pages/Embed.aspx?id=abc-123&case=captions"></iframe></html>',
    );
    return;
  }
  const scenario = url.searchParams.get("case") || "captions";
  const link = (name) =>
    `<a download="${name}" href="/files/${name}">${name}</a>`;
  let resources = link("primary.mp4");
  if (["dual", "multiple"].includes(scenario))
    resources += link("secondary.mp4");
  if (scenario === "multiple")
    resources += link("audio.m4a") + link("third.mp4");
  if (["captions", "slides"].includes(scenario))
    resources += link("captions.vtt");
  if (scenario === "slides")
    resources +=
      link("slide_001.jpg") +
      link("handout.pdf") +
      '<video><track kind="chapters" src="/files/chapters.vtt"></video>';
  if (scenario === "restricted")
    resources =
      '<video src="/files/private.mp4"></video>' + link("stream.m3u8");
  if (scenario === "browser-managed")
    resources =
      '<video src="blob:http://localhost:4173/fictional-player"></video><audio></audio>';
  if (scenario === "network-hls")
    resources =
      '<video src="blob:http://localhost:4173/fictional-network"></video><script>fetch("/hls/master.m3u8").then(r=>r.text());</script>';
  if (scenario === "network-tracks")
    resources =
      '<video id="test-video"></video><script>fetch("/hls/tracks.m3u8");fetch("/hls/audio.m4a");fetch("/files/captions.vtt");const t=document.getElementById("test-video").addTextTrack("captions","English","en");t.mode="hidden";t.addCue(new VTTCue(1.25,3.5,"Loaded fictional cue"));</script>';
  if (scenario === "errors") resources += link("error.mp4");
  if (scenario === "malformed")
    resources =
      '<a download href="javascript:alert(1)">Invalid</a><script type="application/json">{bad</script>';
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><head><title>Fictional Physics</title><meta name="duration" content="3600"></head><body><h1>Fictional Physics</h1>${resources}</body></html>`,
  );
});
if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(4173, "127.0.0.1", () =>
    console.log("Mock Panopto on http://localhost:4173"),
  );
