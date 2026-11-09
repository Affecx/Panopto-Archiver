# Obsidian study plugin

An initial desktop plugin is available in [obsidian-plugin/README.md](obsidian-plugin/README.md). It connects the v2 archiver to local Ollama or ChatGPT-authenticated Codex study generation, with source citations, local secret references and token controls. The plugin no longer uses an OpenAI API key. Runtime files have been repaired in the open vault; native activation still needs confirmation.

# Version 2 — browser-driven Python app

A separate implementation now lives in [v2/README.md](v2/README.md): Playwright + Beautiful Soup + HTTPX, with a normal interactive browser sign-in and disk-streamed exports. The original extension below is retained as v1.

# Panopto Archiver

Local-first Chrome Manifest V3 extension, built with strict TypeScript, WXT and React. Archives explicit HTML download links and, when requested with **Find playback streams**, supported network-observed media on Panopto Viewer/Embed pages. No university account, hosted backend or password collection is required by the extension.

## Install and develop

Use Node 22.12+ (tested with Node 26) and npm.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3` inside this repository. Pin the extension. Open an authorised lecture and click the extension icon, then **Open export manager**. Review the checklist and choose Folder or ZIP. Refresh after the viewer has finished loading. For custom institution domains, open the viewer directly and use **Grant custom site access** in the popup.

Folder saves files under `Downloads/Lecture_Title/` using Chrome downloads. ZIP uses a save picker and streaming writer when supported, with a bounded buffered fallback. Keep the export manager open until it finishes. Retry failed items after fixing network/access issues. Browser “Ask where to save each file” preferences can prompt for every folder file.

```sh
npm run dev
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run test:all
node mock/server.mjs
```

Mock example: `http://localhost:4173/Panopto/Pages/Viewer.aspx?id=abc-123&case=captions`.

## Implemented scope and limitations

- Viewer/Embed URL detection, DOM title/duration, explicit downloadable video/audio, caption files, slide/presentation files and attachments.
- Checklist, unavailable-resource reasons, per-resource progress, partial failure reports, retry by selection, filename sanitisation, JSON manifests without source URLs.
- Original SRT/VTT plus readable text, SRT and structured timed JSON. No AI transcription or invented timings.
- Chapters found as playback tracks are reported; proprietary chapter/slide timeline schemas are not assumed.
- Browser-managed players remain unselectable by default. **Find playback streams** separately discovers direct files and HLS candidates from browser resource timing and recent network requests. Unencrypted MPEG-TS HLS VOD can be assembled into a `.ts` video; encryption, live streams, DASH, fMP4, byte ranges and discontinuities are rejected. Separate HLS audio/video renditions are listed individually; MPEG-TS renditions can be exported as separate files. No DRM keys are fetched and access-denied responses are not worked around.
- This is a functional generic DOM adapter, **not verified against a real Panopto tenant**. Panopto often uses scripted download controls rather than HTML download attributes; such pages may expose zero downloadable resources until a verified adapter is added. No undocumented endpoints are called.
- REST OAuth integration, proprietary stream metadata, complete slide timelines, interrupted-job resume and broader stream-format support remain future work. See [discovery research](docs/panopto-discovery.md).
- Streaming ZIP avoids buffering media but a network failure while writing an entry can leave an incomplete archive entry. Such exports are partial or fail; discard and retry. Buffered fallback caps individual media at 128 MiB and captions at 10 MiB; overall fallback ZIP memory still grows with archive size. Prefer streaming ZIP for large assembled HLS lectures; Folder uses native streaming only for direct files.
- Only job summary counts/timestamps are persisted. Resource URLs remain in memory; closing the manager requires rediscovery. Browser download history may retain source URLs as part of normal Chrome operation.

See [architecture](docs/architecture.md), [resource schema](docs/resource-schema.md), [testing](docs/testing.md), and [roadmap](docs/roadmap.md).

If the list is empty, first check whether the lecture title appears. No title indicates a connection, URL or embedding problem; Refresh now attempts to attach to already-open lecture tabs. A visible title with no resources means the current DOM adapter found no supported links, not that export was forbidden. Open any player download/transcript menu and refresh discovery. Script-only controls need verified markup before an adapter can be added.

## Export a playback feed

1. Reload the extension in `brave://extensions` or `chrome://extensions` after this update (it adds the `webRequest` permission). Reload and play the lecture so its requests become visible.
2. Open **Open export manager**, then **Find playback streams**. This is an explicit user action to use network candidates, not a claim that playback grants export rights. Export only recordings you are authorised to archive.
3. If a candidate uses a different CDN origin, **Allow detected stream hosts** requests access only to the detected origins. No new mandatory all-sites access is added. After granting access, run Find playback streams again so master-playlist audio renditions can be inspected. Request URLs with opaque paths or undisclosed cross-origin timing may remain undiscovered.
4. Select the playback candidates and export. HLS playlists are validated at export. Streaming ZIP writes segments sequentially without holding the video in RAM; Folder and fallback ZIP cap assembled media at 128 MiB. Use a player supporting MPEG-TS, such as VLC, for the resulting `.ts` video. There is no MP4 transcode, camera/screen composition or separate audio muxing. Multiple supported feeds produce separate video files.

Network capture is read-only: no request headers, cookies or response bodies are intercepted. At most 24 candidate URLs per tab are kept in service-worker memory, cleared on navigation/close and ignored after 10 minutes of inactivity. A worker restart loses this cache; resource timing can recover recent page requests. Signed URLs never enter generated manifests. A genuine Lancaster session has not been tested.

### Missing transcript or audio

The playback action also recognises M4A/MP3/AAC/WAV/OGG/Opus files and VTT/SRT files. Standard HTML track URLs are inspected along with network resource timing. HLS master playlists are inspected for separate audio/video renditions and language information. The master itself is disabled when separate renditions are found; select individual feeds. Only MPEG-TS segment assembly is supported, so raw AAC and fMP4 HLS still require another adapter. Direct audio files remain supported.

Enable captions in Panopto, allow them to load, then click Find playback streams again. Existing browser text-track cues can be exported as a VTT snapshot with TXT/SRT/JSON derivatives. Snapshots explicitly warn that they may be incomplete: the player may load only a portion of the recording. Unloaded tracks are listed with instructions rather than fabricated data. Caption JSON from proprietary Panopto API endpoints is not interpreted without a verified schema. Segmented WebVTT HLS renditions are detected but unsupported because timestamp-map handling is not implemented. No AI transcript or guessed timing is generated.
