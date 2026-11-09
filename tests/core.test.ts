import { describe, it, expect } from "vitest";
import { parseLectureUrl } from "../src/discovery/session";
import { discover } from "../src/discovery";
import {
  filename,
  manifest,
  selectedResources,
  exportSession,
} from "../src/export";
import { parseCaptions, seconds, srt, timestamp } from "../src/captions";
import type { Session } from "../src/types";
const url = "https://example.panopto.com/Panopto/Pages/Viewer.aspx?id=abc-123";
function doc(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}
const session: Session = {
  id: "test",
  title: "Test",
  warnings: [],
  resources: [
    {
      id: "1",
      kind: "video",
      name: "primary.mp4",
      format: "mp4",
      url: "https://example.com/video?secret=token",
      status: "available",
    },
    {
      id: "2",
      kind: "audio",
      name: "Restricted",
      format: "mp3",
      status: "restricted",
    },
  ],
};
describe("discovery", () => {
  it.each(["Viewer", "Embed"])("parses %s", (mode) =>
    expect(parseLectureUrl(url.replace("Viewer", mode))).toBe("abc-123"),
  );
  it.each([
    "invalid",
    "https://example.com/watch?id=x",
    "https://example.com/Panopto/Pages/Viewer.aspx?id=<script>",
  ])("rejects %s", (u) => expect(parseLectureUrl(u)).toBeUndefined());
  it("extracts metadata and explicit links", () => {
    const s = discover(
      doc(
        '<title>Physics</title><meta name="duration" content="60"><a download="camera.mp4" href="/camera.mp4">Camera</a><video src="/private.mp4"></video>',
      ),
      url,
    );
    expect(s.title).toBe("Physics");
    expect(s.duration).toBe(60);
    expect(s.resources.map((r) => r.status)).toEqual([
      "available",
      "restricted",
    ]);
  });
  it("rejects unsafe and streaming resources", () => {
    const s = discover(
      doc(
        '<a download href="javascript:alert(1)">Bad</a><a download href="/stream.m3u8">Stream</a>',
      ),
      url,
    );
    expect(s.resources).toHaveLength(1);
    expect(s.resources[0]?.status).toBe("unsupported");
  });
  it("handles missing metadata", () =>
    expect(discover(doc(""), url).resources).toEqual([]));
});
describe("captions", () => {
  it("preserves millisecond timing", () => {
    const c = parseCaptions(
      "WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHello <b>world</b>\n",
    );
    expect(c).toEqual([{ start: 1.25, end: 3.5, text: "Hello world" }]);
    expect(srt(c)).toContain("00:00:01,250 --> 00:00:03,500");
  });
  it("parses SRT and multi-line cues", () =>
    expect(
      parseCaptions("1\n00:00:01,000 --> 00:00:02,000\nA\nB")[0]?.text,
    ).toBe("A\nB"));
  it("does not invent timings", () =>
    expect(parseCaptions("Just words")).toEqual([]));
  it("rejects invalid timings", () => {
    expect(() => seconds("bad")).toThrow();
    expect(() => parseCaptions("00:03.000 --> 00:01.000\nBad")).toThrow();
  });
  it("carries rounded milliseconds", () =>
    expect(timestamp(59.9999)).toBe("00:01:00.000"));
});
describe("export", () => {
  it.each(["../bad/name", "CON", "...", "a\\b:c"])("sanitises %s", (name) =>
    expect(filename(name)).not.toMatch(/[\\/:]/),
  );
  it("filters restricted selection", () =>
    expect(selectedResources(session, ["1", "2"])).toHaveLength(1));
  it("redacts URLs", () =>
    expect(JSON.stringify(manifest(session, []))).not.toContain("secret"));
  it("exports bytes and manifests", async () => {
    const files = new Map<string, Blob>();
    const outcomes = await exportSession(
      session,
      ["1"],
      {
        write: async (p, b) => {
          files.set(p, b);
        },
      },
      () => {},
      async () => new Response("video") as never,
    );
    expect(outcomes[0]?.status).toBe("success");
    expect(files.has("media/001_primary.mp4")).toBe(true);
    expect(files.has("metadata/resources.json")).toBe(true);
  });
  it("records HTTP failure without adding resource file", async () => {
    const files: string[] = [];
    const outcomes = await exportSession(
      session,
      ["1"],
      {
        write: async (p) => {
          files.push(p);
        },
      },
      () => {},
      async () => new Response("", { status: 403 }) as never,
    );
    expect(outcomes[0]?.status).toBe("failed");
    expect(files.some((p) => p.startsWith("media"))).toBe(false);
  });
});

describe("playback reporting", () => {
  it("reports browser-managed and source-less players without exposing their URLs", () => {
    const session = discover(
      doc(
        '<video src="blob:https://example.com/private-buffer"></video><audio></audio>',
      ),
      url,
    );
    expect(session.resources).toHaveLength(2);
    expect(session.resources.map((r) => r.kind)).toEqual(["video", "audio"]);
    expect(
      session.resources.every((r) => r.status === "restricted" && !r.url),
    ).toBe(true);
    expect(JSON.stringify(session)).not.toContain("private-buffer");
  });
  it("classifies child audio sources and avoids duplicate parent/source entries", () => {
    const session = discover(
      doc(
        '<audio><source src="/sound.m4a"></audio><video src="/camera.mp4"><source src="/camera.mp4"></video>',
      ),
      url,
    );
    expect(session.resources.map((r) => r.kind)).toEqual(["audio", "video"]);
  });
  it("keeps an explicit downloadable resource selectable instead of duplicating playback", () => {
    const session = discover(
      doc(
        '<a download="camera.mp4" href="/camera.mp4">Download</a><video src="/camera.mp4"></video>',
      ),
      url,
    );
    expect(session.resources).toHaveLength(1);
    expect(session.resources[0]?.status).toBe("available");
  });
});
