# Panopto Study for Obsidian

Panopto Study imports authorised Panopto lectures into a desktop Obsidian vault. It builds interactive study pages from captions, local recordings and Markdown notes. It can also run saved prompts against selected vault files and folders.

## Install

Use Obsidian Desktop 1.11.4 or newer. [Set up the V2 Python helper](../v2/README.md#setup), then run these commands from the repository root:

```sh
npm --prefix obsidian-plugin ci
npm --prefix obsidian-plugin run package
```

Extract `obsidian-plugin/dist/panopto-study.zip` into `<vault>/.obsidian/plugins/`. The ZIP contains `panopto-study/main.js`, `manifest.json` and `styles.css`. Enable **Panopto Study** under **Community plugins** and set **Python executable** to the absolute path of `v2/.venv/bin/python`.

Choose a model provider in **Settings → Panopto Study**:

- **Codex (ChatGPT sign-in)** uses a locally installed Codex CLI. Sign in with `codex login`, then set **Codex executable** to its absolute path. Your signed-in account receives the text approved for generation.
- **Local Ollama** uses a loopback endpoint and a model already installed on your machine. Set **Ollama endpoint** and **Local model**. **Local Ollama output token cap** controls the generation limit.

**Maximum AI context bytes** limits the input size. This setting measures bytes. Model token use varies.

## Import a lecture

Right-click a destination folder and choose **Import Panopto lecture here**. Enter the lecture URL and sign in yourself in the Chromium window. The helper prepares the player and opens captions when it recognises the controls.

Turn on **Find playback streams** only for material you are authorised to archive. Select **Download videos and attachments too** when you want local media. **Interactive HTML** is the default output. You can also save a Markdown companion. The archive and study materials go in a lecture subfolder of the chosen destination.

**Remember university login** optionally stores the authenticated browser session in the OS keychain. If the session expires, sign in again. Use **Saved login** in the import dialog to remove the saved session for a site.

## Create a worksheet from a folder

Right-click a folder and choose **Create learning page from folder**. Review the source list and provider, then choose **Generate study material**. The plugin reads Markdown notes in the folder and its subfolders, plus captions from V2 archives it finds there. It can also build a worksheet from notes alone.

The plugin saves the page in the selected folder’s `learning/` directory and opens it in your browser. Earlier worksheets are preserved. Citations distinguish notes from captions and switch to the corresponding recording when available. [Using and rebuilding learning pages](../docs/interactive-learning.md)

## AI macros

In **Settings → Panopto Study → Macros**, choose **Add macro** and enter a name and prompt. Select whether a macro launched on a file uses that file alone or its containing folder. Launching a macro on a folder uses that folder and its subfolders.

Right-click a file or folder and choose **AI macros…**. Review the starting scope and the proposed edits. The model starts with a directory listing or a selected file path. It can browse subfolders and read individual files within that scope. It can release file contents to make room for other reads. Each request stays within **Maximum AI context bytes**. File scope can replace the selected text file. Folder scope can replace text files in its starting context or create files in existing subfolders. The plugin checks paths and file changes before writing. Macros work with regular UTF-8 files and exclude hidden paths, symbolic links and common credential files.

A macro can pause to request specific vault files or folders and explain why it needs them. You can share selected paths, continue without sharing, or cancel. An approved folder lets the macro browse its subfolders and read individual files. Approved context is read-only for that run. Write approvals apply to the starting scope. A run can make up to ten rounds of browsing and reading requests. A file must fit in the available context to be read.

## Tests and development

Run `npm --prefix obsidian-plugin run test:all` from the repository root. [Set up Chromium and FFmpeg for testing](../README.md#panopto-archiver). The plugin suite checks the bundle, folder selection, macro scope and the learning page in Chromium with locally generated media. For optional provider smoke tests, run `npm --prefix obsidian-plugin run test:local` or `npm --prefix obsidian-plugin run test:codex` with the corresponding provider configured.
