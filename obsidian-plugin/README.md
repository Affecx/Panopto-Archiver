# Panopto Study — Obsidian desktop plugin

Import an authorised Panopto lecture and generate study notes using **Codex with ChatGPT sign-in** or **local Ollama**. OpenAI API-key support has been replaced with Codex. The plugin creates summaries, takeaways, worked-example drafts, recall questions, source-excerpt citations and local media links.

Status: initial implementation, compiled and tested with simulated Obsidian APIs and real Chromium helper tests. The runtime files have now been installed/repaired in the open vault; successful native activation is still unverified. Incomplete caption snapshots and unknown proprietary Panopto JSON schemas remain limitations of the local archiver.

## Install

Requires Obsidian 1.11.4+ on desktop, Node/npm for building and the local v2 Python package/Chromium.

```sh
# From the repository root:
v2/.venv/bin/python -m pip install -e './v2[test]'
v2/.venv/bin/python -m playwright install chromium
npm --prefix obsidian-plugin ci
npm --prefix obsidian-plugin run test:all
```

Recommended: run `npm --prefix obsidian-plugin run package`, then extract `obsidian-plugin/dist/panopto-study.zip` into `<vault>/.obsidian/plugins/`. The ZIP already contains the correct `panopto-study/` folder with the three runtime files.

Do not copy the entire project directory: Obsidian cannot load a source folder whose compiled `main.js` is nested under `dist/`. Alternatively, copy `main.js`, `manifest.json` and `styles.css` from `obsidian-plugin/dist/` into `<vault>/.obsidian/plugins/panopto-study/`. Reload Obsidian and enable the plugin. Configure its Python executable with the absolute path to `v2/.venv/bin/python`. The failed installation was repaired in the open vault on 2 November: the misplaced source folder was moved to `.obsidian/plugin-backups/`, settings were preserved when present, and the three tested runtime files were installed in `.obsidian/plugins/panopto-study/`. Plugin enablement settings were not changed.

Choose vault-relative study-note and source-archive folders. Source archives can include large videos. Existing study notes are preserved by creating numbered sibling notes.

## Codex setup

Install the Codex CLI and run `codex login` yourself, choosing **ChatGPT sign-in**. The plugin invokes that installed CLI; it does not copy/read its authentication files or ask for an OpenAI API key. Existing ChatGPT-authenticated Codex credentials can be reused. Account access and usage limits still apply. This is not unlimited or offline processing: transcript text is processed by the remote Codex service.

In plugin settings, choose **Codex (ChatGPT sign-in)** and set the executable path. On macOS, an absolute path is recommended because Obsidian launched from the Dock may not inherit your terminal PATH. Use `command -v codex` in your terminal to find it. Leave the Codex model field empty to use its default, or select a model accessible through your Codex account.

This adapter requires recent CLI features tested with **codex-cli 0.166.0**. Older releases lacking the required flags fail rather than falling back to unsafe execution. [Official non-interactive documentation](https://developers.openai.com/codex/noninteractive) and [CLI reference](https://developers.openai.com/codex/cli/reference) describe this integration surface.

### Constrained runs

- Send compact lecture data over **stdin**, never command arguments.
- Verify `codex login status` reports ChatGPT sign-in. Refuse API-key authentication and remove `OPENAI_API_KEY`/`CODEX_API_KEY` environment overrides from child processes.
- Use an empty temporary working directory, an explicit JSON output schema, **read-only** sandboxing and **ephemeral** session mode.
- Ignore user configuration for this narrow summarization task so unrelated configured hooks/connectors are not loaded. Disable shell, app, browser, computer-use, skill-search and remote-plugin features; disable web search and project-document loading. No sandbox bypass flags are used.
- Replace the generic coding instructions with a short study-only instruction file using the documented `model_instructions_file` setting. That file contains generic instructions, not transcript text. This reduces coding-agent prompt overhead; the [configuration reference](https://developers.openai.com/codex/config-reference) documents the replacement.
- Write only temporary schema/instruction/result artifacts, delete them after the call, and keep raw CLI output/errors out of UI logs. Generated notes/caches are explicit local outputs.

The plugin does not inspect your vault through Codex or give it the source-media folder as its workspace. The explicit model input is the cleaned transcript and source IDs. A read-only sandbox is not a promise of semantic correctness or a guarantee about every future CLI version; retain the required flags and tests when updating Codex.

## University login is separate

University passwords, SSO, MFA and CAPTCHA stay in the local Chromium window. Enter the lecture link, enable **Find playback streams** only when you have permission to export them, sign in in the opened browser. The helper waits for the requested lecture player, starts playback if paused, opens the Captions/Transcript panel, and clicks an explicit Show/Enable captions control when available. Already-enabled captions remain enabled. No Continue click is needed in the updated plugin. Study imports default to captions only. Enable **Download videos and attachments too** when media is needed; this avoids unnecessary camera/slide downloads during note generation.

**Remember university login** is opt-in. It stores authenticated browser state only in an OS-backed Python keyring: macOS Keychain, Windows Credential Locker, Secret Service or KWallet. There is no plaintext/session-file fallback. State is captured after page/caption loading, so late iframe cookies are included. Sessions can expire or require MFA again. This secure local persistence is the explicit exception requested by the user to v2's otherwise ephemeral-session policy.

**Forget saved login for entered site** deletes that site's saved local session. It does not change your password or revoke the server-side session. Keychain access may require an OS prompt. Tests use fake keychain storage and did not save a real university session. [Keyring documentation](https://keyring.readthedocs.io/en/stable/).

Old API settings are ignored and removed from plugin settings on the next settings save. Any previously created Obsidian SecretStorage entry is left untouched because it may be shared with another plugin. This plugin no longer reads or needs it.

## Local Ollama

Choose Local Ollama, a loopback endpoint (default `http://localhost:11434`) and an installed model name. Only loopback hosts are accepted. The plugin does not download models automatically.

Development downloaded the small `qwen2.5:0.5b` model for a live integration test. It produced schema-valid output and source citations, but repetitive/simplistic worked examples. This verifies connectivity and contracts, not suitability for complex university study. The real software-development lecture comparison also tested `qwen2.5:1.5b`; it completed after a truncation/resume but contained factual contradictions and an unsafe C example. Neither tested small model is recommended for unattended study-note generation. A stronger model needs separate evaluation. [Ollama chat API](https://docs.ollama.com/api/chat).

## Token and usage controls

- Remove verified caption-panel UI controls and deduplicate identical text at the same observed time across duplicate snapshots.
- Send compact `[source ID, text]` pairs; keep file paths and timestamp display labels local.
- Prefer one Codex generation for a lecture within the configured cleaned-transcript byte limit. Local Ollama uses smaller chunks.
- Cache validated chunks and full study data. Exact unchanged input/provider/model settings reuse cached results with **no new generation**.
- Do not resume a conversation or replay generated history. Do not upload video/audio or transcribe speech again when a transcript exists.
- Use short study-only Codex instructions and low reasoning effort. Record returned input/cached-input/output usage when the CLI reports it.
- No automatic retries for failed, malformed or truncated generations. Ollama records finish reason and load/prompt/generation timings; length-limited output is rejected.
- For large source lists, keep the generation schema compact while validating every returned citation against the full allowed-ID set.
- Codex sign-in checks time out after 30 seconds; generation after 300 seconds. A timeout can still consume usage.

**Codex CLI has no supported hard output-token or dollar cap in this integration.** The configured output-token cap is for Ollama only. The review modal explicitly distinguishes the providers. Input bytes are a size guard, not an exact token estimate; Codex harness overhead still contributes to usage. ChatGPT/Codex plan limits apply, and caching/minimal prompts do not imply unlimited usage.

## Notes and examples

Every takeaway/example must cite IDs present in its request. Missing IDs or incomplete example structure fail validation. Examples include the problem, solution steps, answer and a consistency check. They are **AI-generated drafts, not independently executed or verified**; arbitrary generated code is never executed. Citation identity validation does not prove the model's reasoning or factual accuracy. Rendered notes flag repeated solution steps and unbounded C `%s` input; these warnings do not catch every unsafe or incorrect example.

The note includes source excerpts for review. Model HTML/embed syntax is escaped, and transcript content is treated as untrusted data. Missing transcripts stop generation; partial/archive coverage warnings remain visible. Media roles and cross-feed synchronization are not guessed.

Closing the import window stops an active archiver process and prevents subsequent note creation; an already running model request may still consume usage until it finishes or times out. Removing generated caches causes future matching work to run again.

## Tests

```sh
npm --prefix obsidian-plugin run test:all
npm --prefix obsidian-plugin run test:local
npm --prefix obsidian-plugin run test:codex
```

- **17 plugin tests + typecheck/build passed.** Tests verify Codex ChatGPT-login enforcement, API-key environment exclusion, stdin input, sandbox/ephemeral flags, usage extraction, temporary cleanup, Ollama protocol, citations, transcript cleanup and cache reuse. A simulated Obsidian API writes real files to a temporary vault and confirms repeat generation avoids another model call. It does not replace native Obsidian UI testing.
- **Live Codex passed** with the existing ChatGPT sign-in and fictional Boolean-logic text. The source was synthetic, not a real lecture. The study JSON was schema/citation validated and written to `dist/codex-test-study.md`.
- **Live Ollama passed** on fictional material. The result is `dist/local-test-study.md`.
- V2 passed 29 Python tests including real Chromium helper/session reuse with fake keychain storage. Real Obsidian installation/UI and real university keychain persistence still need verification.

The old live API runner has been removed; no API key is required for either provider.

### Measured prompt-overhead check

On the same short fictional fixture with the default signed-in Codex model, the first constrained run reported 11,528 input tokens and 283 output tokens. Replacing generic coding instructions with the short study-only instruction file reported 7,367 input tokens and 216 output tokens. This single check reduced reported input usage by 4,161 tokens (about 36%). It is not a general benchmark or a guarantee for other lectures/models; Codex still has substantial harness overhead. Both runs used ChatGPT sign-in, not API-key billing.

### Installation failure regression

The observed failed installation had folder name `obsidian-plugin`, a root manifest, and `dist/main.js` but no root `main.js`. The repair preserves that source folder as a backup and installs only the runtime files under the canonical manifest ID. A new test executes the actual bundled CommonJS code with a minimal Obsidian host and calls `onload`, verifying command/settings registration without credentials or a model. Package creation checks that the ZIP contains exactly three correctly rooted runtime files. The installed files were compared byte-for-byte to the tested build. This does not replace final user activation inside Obsidian.

## Real lecture comparison — 2 November 2026

The supplied second software-development lecture was captured through authenticated Chromium as rendered caption-panel snapshots (492 excerpts, 0:03–47:09). Completeness remains unverified. Shared normalization reduced two panel copies from 108,745 bytes to a 50,421-byte compact payload (53.6% fewer bytes, not a token percentage).

Codex completed an optimized full-lecture request in 26.0 seconds, reporting 19,805 input and 965 output tokens. Its two constructed C examples were independently reconstructed and checked with a compiler. An earlier Codex attempt timed out after 180 seconds with unknown usage and is retained in the ledger. Qwen 1.5B used seven requests including one truncated section, 17,766 input/6,498 output tokens and 285.8 seconds; its notes had material quality errors. Tokenizers and chunking strategies differ, so counts are not a common cost unit. Both providers then rerendered from validated caches with zero new inference calls. Codex used ChatGPT sign-in, not API-key billing.

Repeat against an existing local archive (this invokes the selected providers unless cached):

```sh
PANOPTO_BENCHMARK_SOURCE="/absolute/path/to/archive" \
PANOPTO_LOCAL_TEST_MODEL="qwen2.5:1.5b" \
PANOPTO_LOCAL_OUTPUT_TOKENS=2800 \
npm --prefix obsidian-plugin run benchmark
```

`PANOPTO_BENCHMARK_PROVIDERS` optionally selects `ollama`, `codex`, or both comma-separated. Results under gitignored `benchmark-results/` include immutable run snapshots, an append-only usage ledger, cached validated sections and rendered notes. Failed attempts remain recorded; missing usage is unknown. These local files contain lecture text and should not be committed. The actual capture under `v2/benchmark-sources/` is also ignored. This comparison did not perform an end-to-end native Obsidian import of this lecture. The plugin runtime was subsequently updated in the open vault on 4 November 2026. Reload Obsidian to load the updated JavaScript.

## Automatic player preparation — 4 November 2026

The desktop plugin sends `autoPrepare: true` to the helper. The helper watches for the requested origin/session's Viewer or Embed frame across sign-in redirects and popup pages for up to five minutes. It uses visible accessible buttons/tabs (including title-only Play buttons), preserves playing/selected/enabled states and declines ambiguous controls. It does not fill login fields, operate MFA or click similar controls on login pages or other lectures. Missing controls or blocked playback produce a safe warning; open them manually and retry if this player layout is unsupported. English control labels are currently supported. This action does not enable Find playback streams or change export eligibility.

The supplied Lancaster player's Play title, Captions tab and Hide captions state were inspected in a real authenticated session. Automated UI interaction started playback and selected Captions, with actual audio-playing/Pause and populated caption-list states verified. It was paused after verification. The exact shipped helper's end-to-end native Obsidian import still needs verification; this observation establishes the control labels/actions for this session only. Fictional Chromium tests separately exercise the helper itself, including delayed sign-in, popup selection, repeated preparation and actual exported caption bytes. Older helper clients can still use the Continue protocol; the updated plugin requires the updated Python helper.

## Interactive HTML learning page

Imports now offer **Create interactive learning HTML** (on by default), with source video downloads selected by default where eligible. The note links an offline browser page inside the source archive. It includes original recordings, searchable caption excerpts, timestamped source buttons, actual sampled frames, editable/revealed worked exercises, caption recall, progress export and visual-observation annotations for slide/app/web/handwriting/physical demonstrations. It uses original evidence rather than reading back the Markdown study note. Find playback streams remains a separate deliberate opt-in.

Set optional **FFmpeg executable** and **FFprobe executable** paths for reference frames; otherwise PATH is used and missing tools are reported. Open the HTML in a browser and keep it with the archive's media/frames. Generated text is escaped; no model-authored script is executed. This release presents visual references for review but does not send frames to a vision model or automatically interpret physical objects. Slide similarity and cross-feed alignment remain unverified. See [the learning-page guide](../docs/interactive-learning.md) for the real lecture's missing desktop-view limitation and verification details.

## Save into the selected sidebar folder

New imports use the folder selected/clicked in Obsidian's Files sidebar, captured when you open the import dialog. The dialog shows **Save lecture in** before any download. All media, captions, metadata, generated cache, the study note and learning HTML stay together under `<selected folder>/<lecture title>/`. The older source/note folder settings remain for legacy calls; they do not override this explicit destination. Existing archives are not moved.

If no unique existing sidebar folder is identified, the importer asks you to choose one. **Choose folder → ＋ Create new folder…** opens a dialog with **Choose parent**, **Folder name**, and **Create and use folder**. Duplicate names, missing parents, hidden paths and traversal are refused. Alternatively, right-click a folder and select **Import Panopto lecture here**. Selection detection uses narrow sidebar DOM hooks because Obsidian exposes no public API for the current file-explorer folder selection; the validated folder chooser and public file-menu action remain the fallback if a future UI changes.

The runtime was installed and reloaded through Obsidian's Community plugins switch on 4 November 2026. Native UI checks confirmed sidebar detection, destination display, the folder chooser and the new-folder dialog. The Python setting was corrected from a directory to the actual venv executable, and absolute Codex/FFmpeg/FFprobe paths were verified in settings. No lecture download or model generation was started during this UI check. Twenty-three plugin tests pass, including chosen-folder output, collision/missing-parent rejection, ambiguous/missing selection, traversal and unchanged legacy behavior.

## HTML is the primary output

The default output format is now **Interactive HTML (recommended)**, and successful generation opens that HTML in the system's associated browser/application. **Also save a Markdown companion** is off by default. Markdown-only output requires selecting **Markdown note only** explicitly. Existing Markdown files remain untouched. The earlier importer always opened a Markdown companion even when HTML existed; this is corrected. If automatic opening fails, the UI displays the saved HTML path. A failed HTML preparation reports an error and does not silently create Markdown instead. Usage metrics are retained in a neighbouring `.usage.json` file.

The HTML contains embedded CSS and application JavaScript for answer checking, step reveals, source navigation and progress. Generated explanations/code remain data, not executable scripts. Exact caption-word checks are automatic; open-ended worked answers still use explicit self-review rather than claiming reliable semantic grading.

### Guided lessons and video recovery

New interactive pages start with a topic index and **Learn and practise**. Each topic states a goal, explains the mechanism and models an example. The adjacent exercise separates the starting point from the task and gives you space to answer before opening a hint or solution. Use the topic index or Next topic link to move through the worksheet. Pages open in dark mode by default and offer a light mode toggle. DevOps lessons can display Python, pytest and shell snippets in labeled code blocks. Progress counts exercises you mark as checked. **Recall & review** provides separate questions and answers for retrieval practice, with links back to the topic and a prompt to review the next day. Original recordings and transcript excerpts remain available through the source buttons. **Optional caption recall** is available separately. Interactive generation uses a new cache version. Previously exported HTML can still be opened as before.

Open the saved HTML directly in a browser. If a linked video fails, open **Video troubleshooting** on that recording and choose the matching MP4 or WebM from the lecture's `media` folder. The selected file plays in the current tab and can be selected again after a reload.

## Create a worksheet from a folder

Right-click a folder in Files and choose **Create learning page from folder**. Review the source list and provider, then choose **Generate study material**. The plugin uses Markdown notes in that folder and its subfolders and captions from any Panopto v2 archives it finds there. It distinguishes note citations from lecture citations. If multiple archives contain playable local media, the recording selector and timed citations switch between them. It uses saved files without starting another Panopto session. It saves the HTML under the selected folder’s `learning/` directory and opens it. Older worksheets are kept as separate files.

A folder can contain notes alone. Other attachment formats need a Markdown note or saved captions to supply text to the model. Missing or unavailable recordings appear as warnings. Generated caches and worksheet folders are skipped when gathering sources. If the folder exceeds the configured context limit, narrow the selection or raise **Maximum AI context bytes**.

## AI macros

Open **Settings → Panopto Study → Macros**. Choose **Add macro**, enter a name and prompt, and choose whether launching on a file should use the selected file only or its containing folder. Launching on a folder always uses that folder and its subfolders.

Right-click a file or folder and choose **AI macros…**, then pick the saved prompt. Review the scope and source list before sending text to the configured provider. The result shows proposed new files or replacements, with current and proposed text available for review. Choose **Apply** to write the changes. A macro can also return a summary without edits.

Macros work with regular UTF-8 text files. Binary assets, hidden paths, symbolic links, and common credential files are excluded. The selected-file scope can replace that file. A folder scope can replace text files from its snapshot or create files in existing subfolders. The plugin checks paths, new-file collisions, and changed source contents before applying edits. It has no macro actions for deletion, moving files, running commands, or scheduling background work. Macro prompts are stored with plugin settings. Keep credentials out of prompts and files sent for review.

### Requesting wider context

While a macro runs, it can ask for specific files or folders by vault-relative path and explain why it needs them. In **Macro requests more context**, select the requests you want to share, continue without sharing, or cancel the run. A folder request includes its subfolders. Approved text is used for that run only. The macro can still propose writes only in its starting scope. Requests are limited to two rounds, and all text counts toward **Maximum AI context bytes**.
