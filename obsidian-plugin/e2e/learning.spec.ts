import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { renderLearningPage } from "../src/learning";
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

test("interactive learning page uses actual local media, original excerpts and persistent exercises", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "lecture-page-browser-"));
  const browser = await chromium.launch();
  try {
    await mkdir(path.join(folder, "learning/frames"), { recursive: true });
    await mkdir(path.join(folder, "media"));
    const video = path.join(folder, "media/fixture.mp4");
    const result = spawnSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      video,
    ]);
    expect(
      result.status,
      result.error?.message || result.stderr?.toString(),
    ).toBe(0);
    const originalVideo = await readFile(video);
    const image = path.join(folder, "learning/frames/fixture.jpg");
    expect(
      spawnSync(ffmpeg, ["-v", "error", "-i", video, "-frames:v", "1", image])
        .status,
    ).toBe(0);
    const evidence = [
      {
        id: "E1",
        text: "Compilation translates the original program.",
        source: "fictional.txt · 0:01",
      },
    ];
    const study = {
      lessons: [
        {
          title: "What compilation does",
          explanation:
            "Compilation translates a program into instructions for a target machine.",
          walkthrough:
            "Input: source text. Translate each operation. Output: executable instructions.",
          misconception: "Running the output is a separate step.",
          question: "What changes when the target machine changes?",
          answer: "The compiler can produce different machine instructions.",
          evidence: ["E1"],
        },
      ],
      summary: "Fictional study.",
      takeaways: [{ text: "Compile source.", evidence: ["E1"] }],
      examples: [
        {
          title: "Fictional task",
          problem: "Explain compilation.",
          steps: ["Read the source.", "Translate the program."],
          answer: "Executable output.",
          check: "Review diagnostics.",
          evidence: ["E1"],
        },
      ],
      questions: [],
    };
    const media = {
      version: 1,
      feeds: [
        {
          id: "F1",
          label: "Recording view 1",
          path: "media/fixture.mp4",
          duration: 3,
          hasAudio: true,
          role: "unclassified",
          alignment: "unverified",
        },
      ],
      frames: [
        {
          id: "frame1",
          feed: "F1",
          path: "frames/fixture.jpg",
          time: 1,
          origin: "actual recording frame",
          role: "unclassified",
        },
      ],
      warnings: [],
      sampling: "Fictional fixture",
    };
    const html = renderLearningPage(
      "Fictional lecture",
      [study],
      evidence,
      media,
    );
    const file = path.join(folder, "learning/index.html");
    await writeFile(file, html);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    await expect(
      page.getByRole("heading", { name: "Original lecture", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page
          .locator("img")
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Play this moment", exact: true })
      .click();
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Pause all", exact: true }).click();
    await page
      .getByRole("button", { name: "E1 · 0:01", exact: true })
      .first()
      .click();
    await expect(page.locator(".selected-source")).toContainText(
      evidence[0]!.text,
    );
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(1, 0);
    await page.getByLabel("Your attempt: Fictional task").fill("My attempt");
    await page.getByText("Step 1", { exact: true }).click();
    await expect(
      page.getByText("Read the source.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("I checked my reasoning against the source").check();
    await page.getByText("Optional caption recall", { exact: true }).click();
    await page.getByLabel("Missing caption word 1").fill("Compilation");
    await page.getByRole("button", { name: "Check word" }).click();
    await expect(
      page.getByText("Matches the recorded caption.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Your attempt: Fictional task")).toHaveValue(
      "My attempt",
    );
    await expect(page.locator("progress")).toHaveAttribute("value", "2");
    await page.getByLabel("Search original captions").fill("not-present");
    await expect(page.locator(".excerpt")).toHaveCount(0);
    await page.getByLabel("Search original captions").fill("original");
    await expect(page.locator(".excerpt")).toHaveCount(1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export my progress" }).click();
    const item = await download;
    const payload = JSON.parse(await readFile((await item.path())!, "utf8"));
    expect(payload.answers["attempt:0"]).toBe("My attempt");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#learn")).toContainText("Input: source text");
    await page.getByText("Check your understanding", { exact: true }).click();
    await page.getByText("Show the reasoning", { exact: true }).click();
    await expect(
      page.getByText(study.lessons[0]!.answer, { exact: true }),
    ).toBeVisible();
    const guidedFile = path.join(folder, "learning/guided.html");
    const practice = {
      goal: "Predict what depends on the target machine.",
      setup: "The source program is unchanged. Only the target changes.",
      hint: "Think about what the target CPU understands.",
      recallQuestion: "What is the input to a compiler?",
      recallAnswer: "Source code is the input to the compiler.",
    };
    const code = 'print("<script>example</script>")';
    await writeFile(
      guidedFile,
      renderLearningPage(
        "Fictional lecture",
        [
          {
            ...study,
            lessons: [
              {
                ...study.lessons[0]!,
                walkthrough:
                  "Read this example first.\n\n```python\n" + code + "\n```",
                practice,
              },
            ],
          },
        ],
        evidence,
        media,
      ),
    );
    await page.goto(pathToFileURL(guidedFile).href);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await page.getByRole("button", { name: "Light mode" }).click();
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
    await page.getByRole("button", { name: "Dark mode" }).click();
    await page
      .getByRole("link", { name: "What compilation does", exact: true })
      .click();
    const lesson = page.locator("#lesson-1");
    await expect(lesson.locator(".worked-example pre code")).toHaveText(code);
    await expect(lesson.locator("script")).toHaveCount(0);
    await expect(lesson.locator(".guided-task h5")).toHaveText([
      "Starting point",
      "What to do",
    ]);
    await expect(lesson.getByText(practice.setup)).toBeVisible();
    await expect(lesson.getByText(practice.hint)).toBeHidden();
    await lesson.getByText("Show a hint", { exact: true }).click();
    await expect(lesson.getByText(practice.hint)).toBeVisible();
    await expect(lesson.getByText(study.lessons[0]!.answer)).toBeHidden();
    await lesson.getByText("Compare with the worked answer").click();
    await expect(lesson.getByText(study.lessons[0]!.answer)).toBeVisible();
    await lesson.getByLabel("Your answer").fill("Different instructions.");
    await lesson.getByLabel("I checked my reasoning").check();
    const cite = lesson.getByRole("button", { name: "E1 · 0:01" });
    await cite.click();
    await page.getByRole("button", { name: "Back to the exercise" }).click();
    await expect(cite).toBeFocused();
    await page.reload();
    await expect(lesson.getByLabel("Your answer")).toHaveValue(
      "Different instructions.",
    );
    await expect(page.locator("progress")).toHaveAttribute("value", "1");
    await expect(page.getByText(practice.recallAnswer)).toBeHidden();
    await lesson.getByRole("link", { name: "Go to review →" }).click();
    await expect(page).toHaveURL(/#recall$/);
    await page.getByText(practice.recallQuestion).click();
    await expect(page.getByText(practice.recallAnswer)).toBeVisible();
    const folderPage = path.join(folder, "learning/from-folder.html");
    await writeFile(
      folderPage,
      renderLearningPage(
        "Fictional folder",
        [
          {
            ...study,
            takeaways: [
              { text: "Compare sources", evidence: ["E1", "E2", "E3"] },
            ],
          },
        ],
        [
          { ...evidence[0]!, kind: "caption", recording: "first" },
          {
            id: "E2",
            text: "A second recording",
            source: "second.txt · 0:02",
            kind: "caption",
            recording: "second",
          },
          { id: "E3", text: "A folder note", source: "Notes.md", kind: "note" },
        ],
        {
          ...media,
          feeds: [
            { ...media.feeds[0]!, label: "First view", recording: "first" },
            {
              ...media.feeds[0]!,
              id: "F2",
              label: "Second view",
              recording: "second",
            },
          ],
        },
      ),
    );
    await page.goto(pathToFileURL(folderPage).href);
    await expect(page.locator(".feed:visible h3")).toHaveText("First view");
    const sources = page.locator("#transcript");
    await sources.getByRole("button", { name: "0:02", exact: true }).click();
    await expect(page.locator(".feed:visible h3")).toHaveText("Second view");
    await expect
      .poll(() =>
        page
          .locator(".feed:visible video")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(2, 1);
    await sources.getByRole("button", { name: "E3", exact: true }).click();
    await expect(page.locator(".selected-source")).toContainText(
      "A folder note",
    );
    await expect(page.locator(".feed:visible h3")).toHaveText("Second view");
    // Reproduce a broken linked path, then recover with the original local file.
    await rm(video);
    const missing = await browser.newPage();
    await missing.goto(pathToFileURL(file).href);
    await expect(
      missing
        .getByRole("status")
        .filter({ hasText: "could not load fixture.mp4" }),
    ).toBeVisible();
    await missing
      .getByLabel("Choose local video for Recording view 1")
      .setInputFiles({
        name: "fixture.mp4",
        mimeType: "video/mp4",
        buffer: originalVideo,
      });
    await missing
      .getByRole("button", { name: "Play this moment", exact: true })
      .click();
    await expect
      .poll(() =>
        missing
          .locator("video")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(1.1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  }
});
