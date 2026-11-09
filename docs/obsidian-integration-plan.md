# Obsidian study workflow — implementation plan

Status: **planned, not implemented**. Grounded in the current SCCM4310 export and the [audio/transcript inspection](audio-verification.md). No existing vault has been modified or searched, and no recordings have been copied into a vault.

## Target workflow

Archive a lecture → inspect media roles and transcript coverage → generate a study bundle → import one lecture note → watch/read and take linked concept notes → answer recall questions and revisit unresolved topics.

Start with ordinary Markdown, native attachment embeds, properties and core Templates. A community plugin should solve a demonstrated limitation rather than be a prerequisite. Official references: [embeds](https://help.obsidian.md/embeds), [attachments](https://help.obsidian.md/attachments), [properties](https://help.obsidian.md/properties), [Templates](https://help.obsidian.md/Plugins/Templates).

## 1. Establish a reliable study bundle

- Persist a local verification report containing stream inventory, codec, audio presence, duration, start time and full audio-decode result. Keep source URLs and authentication out of reports.
- Assign verified roles: slides/screen, lecturer camera, audio-only or unknown. Resolution and filenames alone must not silently determine roles. For this export the roles have been visually checked.
- Prefer a single **slides + lecturer audio** study video, with the camera recording linked as an optional alternate view. Preserve both original files.
- Before muxing, check observable alignment near the beginning, middle and end. Derive any offset from verified anchors, not duration differences. The current recordings differ by about 23.4 seconds; timestamp starts alone do not prove cross-feed synchronization. If alignment is uncertain, retain independent players and mark synchronization unverified.
- Once alignment is established, use local FFmpeg stream copying when codecs permit. Do not silently use `-shortest` and lose the slide tail. Report missing-audio intervals; any padding or trimming must be an explicit derived-output decision with its provenance recorded.
- Optionally extract the existing AAC to M4A for audio-only revision. This is extraction of existing speech, not new transcription. Check the resulting duration, codec and decode result.

Acceptance: the study video decodes, retains readable slides and verified lecture audio, has a documented timeline mapping, and reports unmatched tails. Camera remains available separately. If this fails, no falsely synchronized study video is generated.

## 2. Normalize the existing transcript

The current two plain-text caption snapshots are duplicates after UI controls are excluded; both have 441 timestamp labels from 0:00 to 49:33.

- Preserve raw snapshots under `Sources/`; generate one canonical Markdown transcript and structured entries containing **observed start times only**.
- Use an adapter based on this verified snapshot layout: text is followed by its displayed time. Add an anonymised fixture with fictional wording and the same structure. Do not apply the layout blindly to other tenants or to arbitrary text files.
- Remove standalone Retry/Cancel controls only in the verified UI context. Never discard spoken wording merely because it happens to match a UI label.
- Deduplicate the two captured panels while retaining source provenance. Mark coverage **snapshot / completeness unverified**; last timestamp is not proof of full coverage.
- Create stable block IDs from lecture identity plus original timestamp/sequence, so concept notes can cite the transcript. Display timestamps as ordinary labels in the first version. Verify seeking before presenting them as functional video jump links.
- No guessed cue end times and no replacement AI transcript. User-authored corrections must remain distinguishable from original captions.

Acceptance: normalized text excludes the observed UI noise, retains all 441 observed labels in order, preserves caption wording, flags coverage uncertainty and has stable block references across repeat imports.

## 3. Generate one Obsidian lecture note

Proposed vault bundle (paths are a design, not files already created):

```text
Courses/SCCM4310/
  SCCM4310 - Course index.md
  Lectures/SCCM4310 - W01 - L01.md
  Transcripts/SCCM4310 - W01 - L01 - Transcript.md
  Concepts/
  Assets/W01-L01/
    study.mp4           # only after verified muxing
    lecturer.mp4
    lecture-audio.m4a   # optional derivative
  Sources/W01-L01/      # raw captions and safe provenance metadata
```

The lecture note contains course/week/lecture properties, processing and review status, media/synchronization/transcript verification state, an embedded study video (or separate labelled feeds), a linked transcript, brief personal notes, concept links, examples, open questions and recall prompts. See [starter template](templates/lecture-study.md).

Default to one active video embed. Link the optional camera view rather than starting two competing players. Use native note/block links for citations into the normalized transcript. A later custom player or small Obsidian plugin can coordinate camera/slide seeking and transcript highlighting; that requires explicit end-to-end testing and a verified timing map.

Acceptance: links and embeds resolve in a clean test vault; the note works without community plugins; duplicate imports do not overwrite personal annotations; uncertain transcripts and synchronization remain visibly labelled.

## 4. Use a repeatable study loop

1. **Before watching:** write two or three questions you expect the lecture to answer.
2. **During watching:** keep the lecture note beside the player/transcript, record timestamps for confusing points, and create concept notes only for ideas worth connecting beyond this lecture.
3. **After watching:** write a short explanation from memory, work one example, add three to five recall questions and link their supporting transcript blocks. Separate quotations from your own interpretation.
4. **During review:** answer questions before reopening the transcript. Revisit the exact supporting passage for gaps, update the concept note and record the next review date.

Core properties can track `status`, `review_due` and `confidence`. Initial review dates should be user-controlled rather than presented as an adaptive learning algorithm. A flashcard/scheduling plugin is an optional later step; the Markdown notes remain the primary record.

## 5. Choose media storage before importing a course

The current slide video is ~90.9 MB and camera video ~176.7 MB (decimal units), ~267.5 MB together before derived files. Keeping all originals, ZIPs and study derivatives in the vault would multiply storage.

- Recommended pilot: put only the verified study video and small transcript/metadata files in the vault; keep raw camera/slide archives outside it, with optional local links. External links are desktop-specific and need a separate strategy for mobile.
- If mobile/offline access matters, use a deliberate in-vault media folder and verify the chosen sync service's per-file and total-storage limits before importing a whole course.
- Do not assume a desktop filesystem link or symbolic link will work across devices. Test native embeddings and playback on each intended platform.
- Obsidian Sync currently documents 5 MB per-file limits for Standard and 200 MB for Plus; these are service-specific and may change. The existing videos exceed Standard's limit. See [official plans and storage limits](https://obsidian.md/help/sync/plans).

No upload, vault permission change, plugin installation or sync reconfiguration is part of this plan.

## Suggested implementation order

| Phase | Deliverable                                                   | Verification                                                                            |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A     | Media inventory, verified roles, optional audio extraction    | Probe streams; decode audio; visually check stream roles                                |
| B     | Deduplicated timestamped Markdown transcript                  | Anonymised real-layout fixture; preserve original wording/labels; completeness warnings |
| C     | One sample lecture note and bundle in a disposable test vault | Open real links/embeds in Obsidian; reimport without overwriting annotations            |
| D     | Verified slides-plus-audio derivative                         | Beginning/middle/end synchronization checks; decode; unmatched-tail report              |
| E     | Course index and recall/review workflow                       | Consistent properties, concept/block links, manual review loop                          |
| F     | Optional synchronized player/plugin                           | Timestamp seeking, drift/error handling, desktop/mobile tests                           |

The first concrete implementation should be phases A–C for this single lecture. This resolves the current duplicate/noisy transcript and provides a useful study note before investing in a custom player. Media muxing follows synchronization verification. Vault selection and desktop/mobile storage preferences are needed before a real import, not before building the exporter against a disposable test vault.
