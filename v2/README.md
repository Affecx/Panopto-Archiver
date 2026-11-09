# Panopto Archiver v2

Panopto Archiver v2 is a local Python application. Playwright controls a real Chromium browser; Beautiful Soup parses the HTML **after JavaScript rendering**; HTTPX streams resource downloads; Python's ZIP64 support packages large archives from disk. The browser starts with its own profile. The Obsidian helper can reuse an opt-in session stored in the OS keychain.

Beautiful Soup alone cannot execute Panopto's player JavaScript. The browser is needed to render captions, discover iframe/shadow-root content and observe actual response content types. The response observer can recognise `text/vtt` or `audio/mp4` even when the endpoint has no `.vtt` or `.m4a` extension.

## Setup

From the repository root (Python 3.9+):

```sh
python3 -m venv v2/.venv
v2/.venv/bin/python -m pip install --upgrade pip
v2/.venv/bin/python -m pip install -e './v2[test]'
v2/.venv/bin/python -m playwright install chromium
```

## Use

```sh
# Safe discovery report, no media export. The URL prompt is not echoed.
v2/.venv/bin/python -m panopto_archiver

# Export supported playback resources you are authorised to archive:
v2/.venv/bin/python -m panopto_archiver --include-playback --export --zip

# Export captions and audio only:
v2/.venv/bin/python -m panopto_archiver --include-playback --export --kind captions --kind audio
```

Enter the lecture URL at the prompt. Sign in **yourself in the opened Chromium tab**. The interactive CLI now waits for the requested lecture player after sign-in, clicks Play if needed, opens Captions/Transcript and enables an explicit Show captions control when present. It preserves already-enabled states; no terminal Enter or manual Play/Captions clicks are required. Login/MFA remain manual. It then captures responses for the configured interval and scans every accessible frame/open shadow root. Use `--capture-seconds 20` if caption loading needs more time. Unknown or ambiguous controls produce warnings; manually prepare the player and retry in unsupported layouts. English labels are currently supported.

`--headless` skips the sign-in prompt and is intended for mock/public recordings. `--output PATH` changes the default `archives-v2` location. The default command only writes an inspection manifest; `--export` writes resources. Without `--include-playback`, only explicit rendered download links are eligible. Do not use playback capture where your institution prohibits export.

## What v2 extracts

- Response types and standard player/resource-timing URLs: direct video, direct audio, WebVTT/SRT, complete unencrypted MPEG-TS HLS VOD.
- Explicit rendered download links, including those inside accessible iframes/open shadow roots.
- Semantically labelled Captions/Transcript panels as plain-text snapshots, without invented timestamps. Availability depends on the player exposing suitable HTML accessibility labels.
- Existing loaded browser caption cues with original timestamps and language. Snapshots are labelled potentially incomplete. Caption files produce readable TXT, timed JSON and SRT derivatives.
- Generic `data-start` chapter/text snapshots, clearly marked as snapshots rather than a verified complete Panopto timeline.
- HLS master audio/video renditions as separate exports. Automatic separate-track muxing is not implemented. Segmented WebVTT, fMP4, live, byte-range/discontinuous streams, DASH and encrypted HLS remain unsupported.

The browser observer checks MIME types as well as file extensions. It does **not** invent Panopto caption API endpoints or parse unknown JSON into guessed transcripts. The inspection manifest counts unparsed JSON responses to make this limitation visible. A future tenant adapter needs a verified anonymised response contract. A new stack does not by itself establish compatibility with Lancaster's proprietary transcript responses.

## Video and ZIP output

Downloads stream into `.part` files and are renamed only after successful transfer. HLS segments are fetched in order into one MPEG-TS video on disk; no full-video RAM buffer is required. Folder exports include only finished resources, plus safe outcome metadata and any explicitly partial caption originals. ZIP creation reads completed files from disk, supports ZIP64, and retains the folder for inspection. Existing exports receive a numbered sibling directory rather than being overwritten.

For optional local TS-to-MP4 remuxing, install FFmpeg separately and pass its executable path:

```sh
v2/.venv/bin/python -m panopto_archiver --include-playback --export --zip --ffmpeg /path/to/ffmpeg
```

FFmpeg receives local file paths only, never session URLs or cookies. Stream copy changes the container; it does not compose camera/screen feeds or add missing audio. Without FFmpeg, use a player supporting `.ts` video. A failed remux retains the original TS and reports a partial export.

## Privacy and failure handling

The browser uses a fresh, nonpersistent context. Cookies are copied only in memory, scoped to each resource's URL through Playwright, and passed to HTTPX for normal authenticated requests. Cookies, request headers, HTML dumps, raw JSON responses and signed URLs are not written to manifests or logs. Redirects and HTML sign-in responses are rejected; there is no DRM decryption, request rewriting, certificate disabling or access-control workaround. Some SSO/CDN protections may permit browser playback but reject HTTPX refetches; those remain failures.

No real lecture credentials are bundled. Tests use fictional sessions and generated media. Program output deliberately omits private exception details. Exit codes: 0 for completed inspection/export, 2 for a partial export/no selectable export, 1 for browser/discovery failure, 130 for interruption. On an abrupt OS termination a `.part` file can remain; it is never included in a generated completed archive. Rerun the command to rediscover and retry in a fresh output directory.

## Tests

```sh
cd v2
.venv/bin/python -m pytest -q
```

Browser tests start a local fictional HTTP server and launch real Chromium. They verify iframe/shadow-root discovery, captions exposed by an opaque endpoint, browser cues, cookie-authenticated audio, unknown-JSON reporting, actual ZIP bytes and URL/auth redaction. Unit tests cover MIME classification, filenames, caption timestamps, HLS restrictions and partial-file cleanup.

Install FFmpeg with H.264 encoding support and FFprobe for the audiovisual checks. The suite creates a fictional HLS recording in a temporary directory, assembles it, remuxes it to MP4 and decodes both audio and video. The learning media check also generates and decodes a reference image. Use `FFMPEG_PATH` and `FFPROBE_PATH` to select explicit executables. These checks skip when the required tools are unavailable.

Authenticated browser testing used rendered caption snapshots from Lancaster. Caption completeness and general tenant compatibility require verification on the target recording. The browser tests use fictional recordings.

## Obsidian helper

The desktop plugin in `../obsidian-plugin` uses `python -m panopto_archiver.bridge`, a private JSON-lines stdin/stdout protocol. Lecture URLs arrive over stdin rather than process arguments; raw exception details, cookies and session state are not printed. Browser-session persistence is opt-in and uses an OS-backed keyring only (`session_store.py`); the ordinary CLI remains nonpersistent. The helper emits sign-in/progress/result events. With `autoPrepare: true` it detects the requested player after sign-in and prepares playback/captions without a Continue decision. Older clients retain their explicit Continue handshake. A restored session does not bypass university MFA, expiry or export policy. See the plugin README for setup, secret storage and model-provider limitations.

The helper accepts an optional resource-kind filter. For a captions-only import, turn off **Download videos and attachments too**. The helper skips HLS media inspection in that mode. Opt-in remembered sessions are captured after page/caption loading, with regression coverage using fake keychain storage. Real university keychain persistence still needs verification.

## Independent local caption check

An optional Apple Silicon Whisper check compares an existing local audio-bearing file with cleaned timestamped caption evidence. It does not access the player or download media. Install with `v2/.venv/bin/python -m pip install -e './v2[verify]'`; an installed FFmpeg executable is required. MLX Whisper and model weights run locally; this uses no transcription API. First use downloads model weights, and optional tokenizer assets, from their upstream repositories. Lecture audio is not uploaded.

```sh
v2/.venv/bin/python -m panopto_archiver.verify_captions \
  --audio /absolute/path/to/audio-bearing-video.mp4 \
  --evidence /absolute/path/to/input-evidence.json \
  --ffmpeg /absolute/path/to/ffmpeg \
  --output /absolute/path/to/local-verification
```

Evidence is the benchmark's cleaned JSON list of `id`, `text` and `source` (ending in an observed ` · m:ss` or ` · h:mm:ss` label). Do not invent timestamps. The default is `mlx-community/whisper-small.en-mlx`, English, temperature zero, word timestamps, no caption prompt and no previous-text conditioning. The check writes mono 16 kHz PCM, independent ASR JSON, cached run metadata, JSON metrics and a Markdown review report. Keep these private source-bearing outputs outside version control. A matching PCM/evidence/model/version cache avoids repeated ASR; it does not certify model accuracy.

The report uses minimum word-level Levenshtein alignment and lowercase/punctuation normalization, retaining fillers and number spellings. It reports exact aligned-word agreement, word disagreement with Whisper as the explicit reference, cue-start timing offsets, one-minute windows and large discrepancies. Neither side is a human ground truth: a disagreement can be an error in either transcript. Whisper can hallucinate and technical C terms can be misheard; low-confidence segments need review. Caption timestamps identify cue starts rather than exact word times. A silent video feed or material beyond the chosen audio track is not verified. The check does not overwrite the captured captions or regenerate study notes automatically. See [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) and the [Whisper model limitations](https://github.com/openai/whisper/blob/main/model-card.md).
