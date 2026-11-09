# Interactive learning pages

Panopto Study writes local HTML worksheets from lecture captions or vault notes. Study text cites source excerpts. If the archive contains supported local videos, the page links to the original recordings and seeks when a caption has a known timestamp. Use the recording selector when multiple archives are available.

Each topic pairs a worked example with an exercise, hint and answer. Caption recall checks the words of an excerpt. Attempts, completion and visual observations are stored in the browser when local storage is available. Use the progress export to keep a copy.

Open the HTML in a browser and keep it in its original location relative to the archive. If playback fails, use **Video troubleshooting** to select the original MP4 or WebM for that feed.

Configure **FFmpeg executable** and **FFprobe executable** in plugin settings, or put both on PATH. The plugin probes local recordings and samples actual frames for visual references. Short actions can fall between samples, and the timing between feeds may require adjustment. The model receives text sources. The images and recordings are there for you to review.

## Rebuild from existing sources

From the repository root, after installing dependencies:

```sh
PANOPTO_LEARNING_ARCHIVE="/absolute/path/to/archive" \
PANOPTO_LEARNING_EVIDENCE="/absolute/path/to/cleaned-evidence.json" \
PANOPTO_LEARNING_STUDIES="/absolute/path/to/validated-studies.json" \
PANOPTO_PYTHON="/absolute/path/to/v2/.venv/bin/python" \
npm --prefix obsidian-plugin run learning:page
```

Evidence is a JSON array with `id`, `text` and `source` fields. The source field can include an observed timestamp. Studies use the structured study array. For explicit tool paths set `PANOPTO_FFMPEG` and `PANOPTO_FFPROBE`. The command preserves earlier pages as numbered siblings.
