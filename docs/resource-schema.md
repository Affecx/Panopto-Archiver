# Resource schema v1

`Session`: id, title, optional duration in seconds, resources and warning strings.

`Resource`: unique id, kind (`video`, `audio`, `captions`, `slides`, `attachment`, `chapters`), display name, format, optional source URL or inline data, language and size in bytes. Status is `available`, `restricted` or `unsupported`; reason explains omissions. Only available selections can be exported. URLs and inline data are stripped from generated manifests.

`metadata/resources.json` contains schemaVersion, minimal session metadata and every discovered resource. Each has an outcome: success/failed/skipped, emitted file paths and an optional generic error. Unselected and restricted resources remain skipped. A failed caption conversion can retain an original file and is reported failed. An empty selection emits only metadata when called programmatically; UI disables export.

Paths are `media/NNN_name`, `transcripts/NNN_name`, `slides/NNN_name`, `attachments/NNN_name` or `metadata/NNN_name`. Indexes prevent collisions. Caption derivatives share a stem and preserve language in the resource manifest. Timed JSON contains start/end seconds and text. No empty resource placeholders, speculative timestamps or authentication URLs are emitted.

Explicit network discovery adds ids `network-N`, anonymous names `playback_N.ts` and `format: "hls"` for HLS candidates. `available` means eligible to attempt export, not that playlist encryption/layout has already passed validation. Validation failures become failed outcomes with a safe reason. Source playlist and segment URLs never enter the manifest. Assembled HLS output is one MPEG-TS file per selected feed.
