# Exported media verification — 2 November 2026

Lecture: `SCCM4310_L01_01_W1`, from the existing v2 export. Originals were inspected without modification. Video roles were confirmed from a frame at 60 seconds; no screenshots or lecture content are committed to this report.

| File                                                    | Verified role     | Container duration        | Video                                               | Audio                     |
| ------------------------------------------------------- | ----------------- | ------------------------- | --------------------------------------------------- | ------------------------- |
| `v2/archives-v2/SCCM4310_L01_01_W1/media/005_video.mp4` | Slide/screen feed | 3007.323425 s (50:07.323) | H.264, 1520×858                                     | **No audio stream**       |
| `v2/archives-v2/SCCM4310_L01_01_W1/media/006_video.mp4` | Lecturer camera   | 2983.923696 s (49:43.924) | H.264, 720×576; video stream duration 2979.066667 s | **AAC, stereo, 44.1 kHz** |

FFprobe inspected the stream inventories and timestamps. FFmpeg decoded the **entire camera audio stream** through `volumedetect`: exit code 0, mean volume −36.8 dBFS and maximum −6.1 dBFS. The recording contains non-silent audio and the audio decodes without a reported error. This is a technical audio-content check, not a claim that every spoken word was listened to or is intelligible.

Camera audio begins at 0.132676 s and camera video at 0.132682 s: their container timestamps differ by approximately six microseconds. The slide feed begins at 0. The overall container durations differ by **23.399729 seconds**. These measurements do not establish the correct cross-feed alignment or explain the unequal tails. Do not derive an offset from the duration difference or silently trim the slide recording to match the camera.

## Transcript inspection

Both `007_captions.txt` and `008_captions.txt` contain **441 displayed timestamp labels**, from **0:00 through 49:33**. Their text is identical after excluding exact standalone UI-control lines `Retry`, `Cancel`, and the automatic-caption warning. The originals remain unchanged. These are rendered panel snapshots, not a verified complete caption API export; timing labels follow their corresponding text in the observed snapshot. The manifest labels the export partial, and these caption files explicitly warn that they may be incomplete.

For future import, preserve the originals, remove UI controls contextually, deduplicate the two snapshots and retain only observed timestamp labels. Do not invent cue end times or describe the transcript as complete merely because its last label approaches the end of the camera recording.
