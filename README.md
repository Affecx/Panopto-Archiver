# Panopto Archiver

Panopto Archiver downloads authorised lecture material to disk. The Obsidian desktop plugin uses those recordings, captions and your notes to build interactive study pages. It also runs saved AI macros on selected vault files and folders.

- [Panopto Archiver v2](v2/README.md) covers Python setup, browser sign-in, export formats and command-line use.
- [Panopto Study for Obsidian](obsidian-plugin/README.md) covers installation, study pages, model providers and macros.

From the repository root, install the Python helper and build the plugin:

```sh
python3 -m venv v2/.venv
v2/.venv/bin/python -m pip install -e './v2[test]'
v2/.venv/bin/python -m playwright install chromium
npm --prefix obsidian-plugin ci
npm --prefix obsidian-plugin run package
```

Extract `obsidian-plugin/dist/panopto-study.zip` into your vault’s `.obsidian/plugins/` folder, enable **Panopto Study**, and set its **Python executable** to the absolute path of `v2/.venv/bin/python`. Choose Codex or Ollama in the plugin settings.

For the full test suite, install FFmpeg with H.264 encoding support and FFprobe, then run:

```sh
npm --prefix obsidian-plugin exec -- playwright install chromium
npm run test:all
```

The suites run TypeScript checks, plugin tests, Chromium learning-page tests and the V2 Python tests. Set `FFMPEG_PATH` and `FFPROBE_PATH` if the executables are outside your PATH. Both browser suites use fictional sources and generate their media locally.
