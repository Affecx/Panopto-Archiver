import { readFile } from "node:fs/promises";
import { exportLearningPage, referenceHelper } from "../src/learning-export";
import { validateStudy, type Evidence } from "../src/study";
const folder = process.env.PANOPTO_LEARNING_ARCHIVE;
const evidenceFile = process.env.PANOPTO_LEARNING_EVIDENCE;
const studiesFile = process.env.PANOPTO_LEARNING_STUDIES;
if (!folder || !evidenceFile || !studiesFile)
  throw new Error(
    "Set PANOPTO_LEARNING_ARCHIVE, PANOPTO_LEARNING_EVIDENCE and PANOPTO_LEARNING_STUDIES to existing local files",
  );
const evidence = JSON.parse(await readFile(evidenceFile, "utf8")) as Evidence[];
const allowed = new Set(evidence.map((e) => e.id));
const studies = (
  JSON.parse(await readFile(studiesFile, "utf8")) as unknown[]
).map((s) => validateStudy(JSON.stringify(s), allowed));
const manifest = JSON.parse(
  await readFile(folder + "/metadata/resources.json", "utf8"),
) as { title: string; partial: boolean };
let visualWarnings: string[] = [];
try {
  const review = JSON.parse(
    await readFile(folder + "/metadata/visual-review.json", "utf8"),
  ) as { warnings: unknown };
  if (Array.isArray(review.warnings))
    visualWarnings = review.warnings.filter(
      (w): w is string => typeof w === "string",
    );
} catch {}
const output = await exportLearningPage(
  {
    folder,
    title: manifest.title,
    studies,
    evidence,
    warnings: manifest.partial
      ? [
          "Source archive is partial. Some HLS attempts failed; the downloaded direct MP4 recordings are available.",
          ...visualWarnings,
        ]
      : visualWarnings,
    ffmpeg: process.env.PANOPTO_FFMPEG || "",
    ffprobe: process.env.PANOPTO_FFPROBE || "",
  },
  referenceHelper(process.env.PANOPTO_PYTHON || "python3"),
);
console.log("Created interactive lecture page:", output);
