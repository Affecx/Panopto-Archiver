# V2 Python application

V2 uses Python 3.9+, Playwright, Beautiful Soup and HTTPX. Keep browser discovery, caption conversion, transport and export separate. Run `.venv/bin/python -m pytest -q` from v2 for v2 changes, and the root `npm run test:all` for changes that affect both components. Test actual Chromium downloads and resulting files; do not rely only on mocked messages.

Do not guess proprietary Panopto JSON schemas or endpoints. Preserve unknown integrations as explicit limitations. Never save cookies, passwords, storage state, full page HTML or raw network dumps. Browser contexts must remain ephemeral. Signed resource URLs belong only in bounded session memory and must not enter manifests, logs or subprocess arguments. FFmpeg receives local files only. Reject DRM/encryption, redirects to login and unsupported layouts. Keep incomplete caption snapshots clearly labelled. Never claim Lancaster compatibility based on fictional fixtures.

The user explicitly approved local OS-keychain authenticated-session storage on 2 November 2026. This narrowly overrides the no-persistence rule above only for opt-in remembered login; browser state must never be saved as plaintext or in the vault/logs. Capture state after frames/captions finish loading. Tests use fake keychain storage.
