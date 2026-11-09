import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffprobe from "@ffprobe-installer/ffprobe";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { Uint8ArrayWriter } from "@zip.js/zip.js";
import os from "node:os";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js";
for (const scenario of [
  "single",
  "network-hls",
  "network-tracks",
  "embedded",
  "dual",
  "multiple",
  "captions",
  "no-captions",
  "slides",
  "restricted",
  "browser-managed",
  "malformed",
  "errors",
])
  test(`archive ${scenario}`, async () => {
    const extension = path.resolve(".output/chrome-mv3");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      acceptDownloads: true,
    });
    try {
      let worker = context.serviceWorkers()[0];
      if (!worker) worker = await context.waitForEvent("serviceworker");
      const id = new URL(worker.url()).host;
      const lecture = await context.newPage();
      await lecture.goto(
        scenario === "embedded"
          ? "http://localhost:4173/moodle"
          : `http://localhost:4173/Panopto/Pages/Viewer.aspx?id=abc-123&case=${scenario}`,
      );
      const tabId = await worker.evaluate(async () => {
        const tabs = await (
          globalThis as unknown as {
            chrome: {
              tabs: {
                query(q: object): Promise<{ id: number; url?: string }[]>;
              };
            };
          }
        ).chrome.tabs.query({});
        return tabs.find(
          (t) => t.url?.includes("Viewer.aspx") || t.url?.endsWith("/moodle"),
        )!.id;
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(window, "showSaveFilePicker", {
          value: undefined,
        });
      });
      await page.goto(`chrome-extension://${id}/export.html?tab=${tabId}`);
      await expect(
        page.getByRole("heading", { name: "Fictional Physics", exact: true }),
      ).toBeVisible();
      if (["restricted", "malformed", "browser-managed"].includes(scenario)) {
        await expect(
          page.getByRole("button", { name: "Export ZIP", exact: true }),
        ).toBeDisabled();
        if (scenario === "browser-managed") {
          await expect(
            page.getByText("Playback video stream", { exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("status")).toContainText(
            "No supported exportable resources",
          );
        }
        return;
      }
      if (["network-hls", "network-tracks"].includes(scenario)) {
        await page
          .getByRole("button", { name: "Find playback streams", exact: true })
          .click();
        if (scenario === "network-hls")
          await expect(
            page.getByText("playback_1.ts", { exact: true }),
          ).toBeVisible();
        else {
          await expect(
            page.getByText("audio_rendition_1.ts", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("loaded_captions_1.vtt", { exact: true }),
          ).toBeVisible();
        }
      }
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Export ZIP", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Select all", exact: true })
        .click();
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export ZIP", exact: true })
        .click();
      const download = await downloadEvent;
      const bytes = await readFile((await download.path())!);
      const zip = new ZipReader(new Uint8ArrayReader(bytes));
      const entries = await zip.getEntries();
      const manifest = entries.find(
        (e) => e.filename === "metadata/resources.json",
      );
      expect(manifest).toBeTruthy();
      const report = JSON.parse(
        await ("getData" in manifest!
          ? manifest.getData!(new TextWriter())
          : ""),
      );
      expect(
        report.resources.find(
          (r: { status: string }) => r.status === "available",
        ).outcome.status,
      ).toBe("success");
      expect(JSON.stringify(report)).not.toContain("http://");
      expect(
        entries.some((e) =>
          e.filename.endsWith(
            ["network-hls", "network-tracks"].includes(scenario)
              ? ".ts"
              : "primary.mp4",
          ),
        ),
      ).toBe(true);
      if (scenario === "network-hls") {
        const media = entries.find((e) => e.filename.endsWith(".ts"))!;
        const bytes = await ("getData" in media
          ? media.getData!(new Uint8ArrayWriter())
          : new Uint8Array());
        const tmp = mkdtempSync(path.join(os.tmpdir(), "panopto-hls-"));
        try {
          const file = path.join(tmp, "assembled.ts");
          writeFileSync(file, bytes);
          const probe = spawnSync(
            ffprobe.path,
            [
              "-v",
              "error",
              "-show_format",
              "-show_streams",
              "-of",
              "json",
              file,
            ],
            { encoding: "utf8" },
          );
          expect(probe.status).toBe(0);
          const data = JSON.parse(probe.stdout);
          expect(Number(data.format.duration)).toBeGreaterThan(3.9);
          expect(
            data.streams.some(
              (s: { codec_type: string }) => s.codec_type === "audio",
            ),
          ).toBe(true);
          expect(
            data.streams.some(
              (s: { codec_type: string }) => s.codec_type === "video",
            ),
          ).toBe(true);
          const decoded = spawnSync(
            ffmpeg.path,
            ["-v", "error", "-i", file, "-f", "null", "-"],
            { encoding: "utf8" },
          );
          expect(decoded.status, decoded.stderr).toBe(0);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }
      if (scenario === "network-tracks") {
        const texts = await Promise.all(
          entries
            .filter((e) => e.filename.endsWith(".txt"))
            .map((e) => ("getData" in e ? e.getData!(new TextWriter()) : "")),
        );
        expect(texts.some((t) => t.includes("fictional physics"))).toBe(true);
        expect(texts.some((t) => t.includes("Loaded fictional cue"))).toBe(
          true,
        );
        const audio = entries.find(
          (e) => e.filename.startsWith("media/") && e.filename.endsWith(".m4a"),
        )!;
        const audioBytes = await ("getData" in audio
          ? audio.getData!(new Uint8ArrayWriter())
          : new Uint8Array());
        const tmp = mkdtempSync(path.join(os.tmpdir(), "panopto-audio-"));
        try {
          const file = path.join(tmp, "audio.m4a");
          writeFileSync(file, audioBytes);
          const result = spawnSync(
            ffprobe.path,
            ["-v", "error", "-show_streams", "-of", "json", file],
            { encoding: "utf8" },
          );
          expect(result.status).toBe(0);
          expect(JSON.parse(result.stdout).streams[0].codec_type).toBe("audio");
          const rendition = entries.find((e) =>
            e.filename.endsWith("audio_rendition_1.ts"),
          )!;
          const renditionBytes = await ("getData" in rendition
            ? rendition.getData!(new Uint8ArrayWriter())
            : new Uint8Array());
          const renditionFile = path.join(tmp, "audio.ts");
          writeFileSync(renditionFile, renditionBytes);
          const decoded = spawnSync(
            ffmpeg.path,
            ["-v", "error", "-i", renditionFile, "-f", "null", "-"],
            { encoding: "utf8" },
          );
          expect(decoded.status, decoded.stderr).toBe(0);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
        expect(
          report.resources
            .filter(
              (r: { status: string; outcome: { status: string } }) =>
                r.status === "available",
            )
            .every(
              (r: { outcome: { status: string } }) =>
                r.outcome.status === "success",
            ),
        ).toBe(true);
      }
      if (scenario === "captions") {
        const transcript = entries.find((e) => e.filename.endsWith(".txt"));
        expect(
          await ("getData" in transcript!
            ? transcript.getData!(new TextWriter())
            : ""),
        ).toContain("fictional physics");
      }
      if (scenario === "errors") {
        expect(
          report.resources.some(
            (r: { outcome: { status: string } }) =>
              r.outcome.status === "failed",
          ),
        ).toBe(true);
        await expect(page.getByRole("status")).toContainText("Partial export");
      }
      await zip.close();
      await expect(page.getByRole("status")).toContainText(
        scenario === "errors" ? "Partial export" : "Export complete",
      );
      await page.screenshot({ path: `test-results/${scenario}.png` });
      // Folder downloads are checked against actual bytes, rather than UI state.
      if (scenario === "single") {
        const downloads: import("@playwright/test").Download[] = [];
        page.on("download", (d) => downloads.push(d));
        await page
          .getByRole("button", { name: "Export Folder", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText("Export complete");
        expect(downloads).toHaveLength(4);
        expect((await readFile((await downloads[0]!.path())!)).toString()).toBe(
          "Fictional resource bytes",
        );
      }
    } finally {
      await context.close();
    }
  });
