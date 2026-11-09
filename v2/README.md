# Panopto Archiver v2

A new local Python application, independent of the v1 WXT extension. Playwright controls a real Chromium browser; Beautiful Soup parses the HTML **after JavaScript rendering**; HTTPX streams resource downloads; Python's ZIP64 support packages large archives from disk. The program does not connect to your existing browser profile or export its authentication state.

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

Unlike v1's URL-extension filter, the browser observer also checks MIME types. It does **not** invent Panopto caption API endpoints or parse unknown JSON into guessed transcripts. The inspection manifest counts unparsed JSON responses to make this limitation visible. A future tenant adapter needs a verified anonymised response contract. A new stack does not by itself establish compatibility with Lancaster's proprietary transcript responses.

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

An additional real-video test requires `FFMPEG_PATH`, `FFPROBE_PATH` and `V2_TEST_MEDIA` (a directory containing an unencrypted generated `video.m3u8` and its TS segments). It assembles video, remuxes MP4, probes both audio/video and fully decodes the output. The repository's existing `node mock/generate-media.mjs` can generate fictional media if its v1 dev dependencies are installed; v2 runtime does not depend on Node. The decode test explicitly skips when these optional validation tools are absent.

Documentation sources: [Playwright browser network events](https://playwright.dev/python/docs/network), [Beautiful Soup](https://www.crummy.com/software/BeautifulSoup/bs4/doc/), [HTTPX streaming](https://www.python-httpx.org/async/).

## Verification in this workspace — 2 November 2026

The earlier dependency-download blocker is resolved. The editable v2 package, Beautiful Soup, HTTPX, pytest and Python Playwright are installed in `v2/.venv`; Playwright Chromium is installed too. `pip check` reports no broken requirements.

Executed verification:

- **33 v2 tests passed, no skips**, including both real Chromium tests and the dependency-free component tests. The run set `FFMPEG_PATH`, `FFPROBE_PATH` and `V2_TEST_MEDIA` to the generated fictional media and local test binaries, so both audiovisual decode tests actually ran. Latest duration: 7.13 seconds.
- A separate **actual CLI smoke test passed** against the fictional embedded lecture. It ran `python -m panopto_archiver` headlessly, returned exit code 0, and produced a ZIP containing cookie-authenticated audio, the expected transcript text and a redacted resource manifest.
- The retained **v1 `npm run test:all` passed** strict typechecking, 53 unit tests, the production extension build and all 13 installed-extension Chromium scenarios.

To repeat the full configured v2 run from the repository root on this Mac, after installing v1 dev dependencies:

```sh
node mock/generate-media.mjs
FFMPEG_PATH="$PWD/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg" \
FFPROBE_PATH="$PWD/node_modules/@ffprobe-installer/darwin-arm64/ffprobe" \
V2_TEST_MEDIA="$PWD/mock/media" \
v2/.venv/bin/python -m pytest -q -c v2/pyproject.toml v2/tests
```

On other platforms use your installed FFmpeg/FFprobe paths. Without these variables the optional real-video checks skip; that is not the fully configured run reported above.

V2 is now ready to launch with `./v2/run.command` from the repository root. Sign in yourself in its fresh browser. Authenticated rendered-caption capture was verified for the supplied Lancaster software-development lecture (492 excerpts, 0:03–47:09), but snapshot completeness and general tenant compatibility remain unverified. Unknown proprietary JSON caption responses still need a verified adapter. Mock-browser and decode tests do not establish tenant compatibility.

## Obsidian helper

The desktop plugin in `../obsidian-plugin` uses `python -m panopto_archiver.bridge`, a private JSON-lines stdin/stdout protocol. Lecture URLs arrive over stdin rather than process arguments; raw exception details, cookies and session state are not printed. Browser-session persistence is opt-in and uses an OS-backed keyring only (`session_store.py`); the ordinary CLI remains nonpersistent. The helper emits sign-in/progress/result events. With `autoPrepare: true` it detects the requested player after sign-in and prepares playback/captions without a Continue decision. Older clients retain their explicit Continue handshake. A restored session does not bypass university MFA, expiry or export policy. See the plugin README for setup, secret storage and model-provider limitations.

The helper accepts an optional resource-kind filter. The study plugin defaults to captions-only and skips HLS media inspection in that mode; full-media export remains selectable. Opt-in remembered sessions are captured after page/caption loading, with regression coverage using fake keychain storage. Real university keychain persistence still needs verification.

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

## Player preparation verification — 4 November 2026

`player.py` is independent of discovery/export and acts only in the requested origin/session's Viewer/Embed frame. Five minutes are allowed for interactive sign-in. No password, MFA, login-form or guessed tenant API automation is used. It selects visible unique semantic controls, including verified title-only Play controls, and leaves already-selected captions enabled. Starting playback does not authorize exports. The live Lancaster player was inspected and its Play/Captions actions were verified through automated native UI interaction; the shipped helper was independently exercised in fictional Chromium sessions. This does not establish compatibility with other tenant layouts.

The fully configured v2 suite now passes **37 tests** (9.40 seconds), including delayed sign-in/popup detection, real browser playback state, idempotent caption preparation, rejection of wrong-session controls and actual captions exported by automatic helper mode. Existing cancellation and audiovisual decode tests remain. The transcript benchmark capture also uses the shared automatic preparation helper.
