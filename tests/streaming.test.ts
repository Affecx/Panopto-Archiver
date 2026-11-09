// @vitest-environment node
import { it, expect } from "vitest";
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js";
import { exportSession, streamingZipSink } from "../src/export";
import type { Session } from "../src/types";
const session: Session = {
  id: "demo",
  title: "Demo",
  warnings: [],
  resources: [
    {
      id: "media",
      kind: "video",
      format: "mp4",
      name: "camera.mp4",
      url: "https://example.com/camera",
      status: "available",
    },
  ],
};
it("streams actual ZIP entries into a writable sink", async () => {
  const chunks: Uint8Array[] = [];
  const sink = streamingZipSink(
    new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
    }),
  );
  const outcome = await exportSession(
    session,
    ["media"],
    sink,
    () => {},
    async () => new Response("streamed fictional media"),
  );
  await sink.close();
  expect(outcome[0]?.status).toBe("success");
  const bytes = Buffer.concat(chunks);
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  const media = entries.find((e) => e.filename.endsWith(".mp4"));
  expect(
    media && "getData" in media ? await media.getData!(new TextWriter()) : "",
  ).toBe("streamed fictional media");
  await reader.close();
});
it("reports interrupted response and succeeds on a fresh retry", async () => {
  const failed = await exportSession(
    session,
    ["media"],
    { write: async () => {} },
    () => {},
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Disconnected"));
          },
        }),
      ),
  );
  expect(failed[0]?.status).toBe("failed");
  const retry = await exportSession(
    session,
    ["media"],
    { write: async () => {} },
    () => {},
    async () => new Response("retry bytes"),
  );
  expect(retry[0]?.status).toBe("success");
});
it("rejects sign-in HTML without leaking URLs in failure", async () => {
  const outcome = await exportSession(
    session,
    ["media"],
    { write: async () => {} },
    () => {},
    async () =>
      new Response("<html>Sign in</html>", {
        headers: { "content-type": "text/html" },
      }),
  );
  expect(outcome[0]?.status).toBe("failed");
  expect(JSON.stringify(outcome)).not.toContain("example.com");
});
