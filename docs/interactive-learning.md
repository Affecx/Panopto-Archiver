# Interactive lecture learning pages

The Obsidian desktop plugin can create `learning/index.html` inside a source archive and link it from the study note. New imports default to creating a page and including authorised media. **Find playback streams stays a separate deliberate action**; generating a page never changes export eligibility. No new website permissions are added.

The generator uses original cleaned caption evidence and exported recordings, independently of the rendered Markdown note. Generated teaching text is validated against allowed evidence IDs. Existing validated model results can be reused; learning-page rendering and reference-image extraction make no additional model calls. The tested software-development page reuses the earlier Codex synthesis alongside all 492 original excerpts, both MP4 recordings and 112 sampled/cited reference frames.

## Learning experience

- Original video feeds with native playback/fullscreen controls, timestamp seeking, adjustable feed offsets and links to the full local files.
- Source buttons on each generated takeaway/example open the original caption excerpt and seek the recordings. Unknown timestamps stay unknown.
- Nearby frames come from actual recording pixels, with their own timestamps and links to full-size images. They are not recreated slides or assumed matches.
- Practice includes an editable attempt, separately revealed steps/answer/check, and explicit self-assessment. Generated code is displayed as text and never executed.
- Caption-recall exercises use words from actual cited excerpts; exact-word feedback checks recall, not conceptual correctness. Other open-ended prompts have no pretend automatic marking.
- A searchable full captured transcript keeps the evidence accessible beyond the generated explanations.
- A visual-observation tool lets the learner classify a moment as slides, desktop/code, website, handwriting/overhead, physical-object demonstration, other/mixed or unreviewed, and record what was actually observed. These are learner annotations, not AI-verified labels.
- Attempts, offsets, annotations and completion are stored in browser-local storage when available. Export progress as JSON to keep a copy. Storage is keyed by source/study content. The page makes no model calls while studying.

The HTML uses fixed application code with escaped source/model data and a hashed-script CSP. It loads no remote assets or scripts, blocks connections and does not evaluate generated code. Keep the HTML, `frames/`, `media.json` and the archive's `media/` directory together in their existing relative layout. It is not a self-contained single-file video bundle. Open the HTML in a browser; Obsidian's Markdown renderer is not the learning-page runtime.

## Media preparation

`python -m panopto_archiver.learning_media` accepts local archive paths over stdin. It only reads exported successful MP4/WebM files from the resource manifest, checks path confinement, probes actual audio/duration and extracts bounded JPEGs through local FFmpeg. It never fetches URLs, auth state or decryption keys. At most four feeds and 96 reference images per feed are indexed. Samples combine cited moments with uniformly spaced whole-feed views; brief gestures and transitions may be missed. The full recordings remain available.

Configure FFmpeg and FFprobe executable paths in plugin settings, or put both on PATH. Without them, the HTML can still link/play exported browser-supported videos, but frame extraction is unavailable and the page says so. TS-only media needs a separately supported local remux before browser playback; it is not silently treated as MP4. No FFmpeg binary is shipped in the plugin ZIP.

## Visual coverage and similarity

Every feed starts unclassified and its alignment unverified. This release does **not** perform vision-model interpretation, OCR, automatic physical-object reasoning, scene segmentation, slide-deck ingestion or a validated 90% slide-similarity measurement. Do not use a matching-looking slide as evidence that a desktop demonstration, pen stroke or object action was captured. Visuals are presented for checking; the generated tutor text currently receives caption text, not frame images. An unseen visual-only explanation can therefore be absent from the generated exercises.

For the supplied lecture, sampled presentation frames at 34:51, 36:31, 39:50 and 46:28 showed the C-essentials slide while captions described a desktop coding demonstration. The app view is unverified or missing in these downloaded feeds. The recordings also have different durations, approximately 47:14 and 51:28. The real page displays these warnings and does not claim synchronized slide matches. There was no supplied separate slide deck; using the actual frames avoids inventing slide equivalents but does not prove complete visual coverage.

## Rebuild from existing source files

From the repository root, after installing dependencies:

```sh
PANOPTO_LEARNING_ARCHIVE="/absolute/path/to/archive" \
PANOPTO_LEARNING_EVIDENCE="/absolute/path/to/cleaned-evidence.json" \
PANOPTO_LEARNING_STUDIES="/absolute/path/to/validated-studies.json" \
PANOPTO_PYTHON="/absolute/path/to/v2/.venv/bin/python" \
PANOPTO_FFMPEG="/absolute/path/to/ffmpeg" \
PANOPTO_FFPROBE="/absolute/path/to/ffprobe" \
npm --prefix obsidian-plugin run learning:page
```

Evidence contains original `id`, `text`, `source` fields with observed timestamps; studies are the structured study array, not parsed Markdown notes. An optional local `metadata/visual-review.json` warnings array can record explicit source-review findings for this CLI. Earlier pages are preserved as numbered siblings. Generated lecture assets remain gitignored and should not be committed.

## Executed verification — 4 November 2026

The real page was rendered in Chromium. Both videos loaded, six currently displayed reference images decoded, no JavaScript errors occurred, and desktop/mobile layouts were inspected. The configured v2 suite passed 39 tests, including actual JPEG extraction/decode and existing audiovisual/browser-download checks. Nineteen plugin tests cover source requirements, URL/path rejection, escaped malicious content, actual page files, preserving earlier output, symlink confinement and a simulated Obsidian import that links the generated HTML.

Root `npm run test:all` includes 53 unit tests, the production extension build, 13 installed-extension download scenarios and a new Chromium learning-page scenario. The new test plays actual audiovisual media, checks image decoding, seeks from a citation, reveals steps, saves/reloads an attempt, checks caption recall, exports and inspects progress JSON, searches original captions and checks mobile overflow. Real native Obsidian import of this exact feature remains unverified. Local mocks do not establish tenant or visual-content compatibility.
