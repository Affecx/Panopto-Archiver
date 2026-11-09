import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Session } from "./types";
import { inspectRenditions } from "./renditions";
import { networkResources } from "./network";
import { scanTab } from "./scan";
import { exportSession, filename, zipSink, streamingZipSink } from "./export";
async function download(blob: Blob, path: string) {
  const url = URL.createObjectURL(blob);
  try {
    await downloadUrl(url, path);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function downloadUrl(url: string, path: string) {
  const id = await browser.downloads.download({
    url,
    filename: path,
    saveAs: false,
  });
  await new Promise<void>((resolve, reject) => {
    const check = async () => {
      const [item] = await browser.downloads.search({ id });
      if (item?.state === "complete") resolve();
      else if (!item || item.state === "interrupted")
        reject(new Error("Download interrupted"));
      else setTimeout(() => void check(), 200);
    };
    void check();
  });
}
export function App() {
  const [session, setSession] = useState<Session>();
  const [ids, setIds] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("Discovering lecture…");
  const [busy, setBusy] = useState(false);
  const [tabId, setTabId] = useState<number>();
  async function scan() {
    setNotice("Discovering lecture…");
    setSession(undefined);
    setIds([]);
    try {
      const supplied = Number(new URLSearchParams(location.search).get("tab"));
      const tab =
        supplied ||
        (await browser.tabs.query({ active: true, currentWindow: true }))[0]
          ?.id;
      if (!tab) throw new Error("Open a lecture tab first.");
      setTabId(tab);
      const s = await scanTab(tab);
      if (!s) {
        setNotice(
          "Connected to the page, but no Panopto Viewer or Embed lecture was detected. If this is Moodle, open the embedded Panopto viewer in its own tab.",
        );
        return;
      }
      setSession(s);
      setIds(
        s.resources.filter((r) => r.status === "available").map((r) => r.id),
      );
      const saved = await browser.storage.local.get("lastJob");
      setNotice(
        (saved.lastJob as { interrupted?: boolean } | undefined)?.interrupted
          ? "A previous export was interrupted. Review and retry resources."
          : s.resources.some((r) => r.status === "available")
            ? "Review the available downloads."
            : "Lecture connected. No supported exportable resources found.",
      );
    } catch {
      setNotice(
        "Could not connect to the lecture tab. Refresh the lecture page after reloading the extension, then try again. For institution domains, use Grant custom site access from the popup on the lecture tab.",
      );
    }
  }
  useEffect(() => {
    void scan();
  }, []);
  async function grant() {
    try {
      const tab = tabId
        ? await browser.tabs.get(tabId)
        : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.url || !tab.id) throw new Error();
      const origin = new URL(tab.url).origin;
      if (await browser.permissions.request({ origins: [`${origin}/*`] })) {
        await browser.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ["/content-scripts/content.js"],
        });
        await scan();
      }
    } catch {
      setNotice(
        "Could not grant access. Open the viewer directly in its own tab.",
      );
    }
  }
  async function allowStreamHosts() {
    const origins = [
      ...new Set(
        session?.resources
          .filter((r) => r.id.startsWith("network-") && r.url)
          .map((r) => `${new URL(r.url!).origin}/*`) || [],
      ),
    ];
    if (!origins.length) return;
    try {
      const granted = await browser.permissions.request({ origins });
      setNotice(
        granted
          ? "Stream host access granted. Retry export."
          : "Stream host access was not granted.",
      );
    } catch {
      setNotice("Could not grant stream host access.");
    }
  }
  async function playback() {
    if (!session || !tabId) return;
    setBusy(true);
    try {
      const captured = await browser.runtime.sendMessage({
        type: "NETWORK_STREAMS",
        tabId,
      });
      let urls: string[] = captured?.urls || [];
      const loadedCaptions: import("./types").Resource[] = [];
      const frames = await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["/content-scripts/content.js"],
      });
      for (const frame of frames) {
        try {
          const found = await browser.tabs.sendMessage(
            tabId,
            { type: "PLAYBACK_URLS" },
            { frameId: frame.frameId },
          );
          urls.push(...(found?.urls || []));
          for (const caption of found?.captions || []) {
            loadedCaptions.push({
              ...caption,
              id: `network-cue-${frame.frameId}-${caption.id}`,
            });
          }
        } catch {}
      }
      const resources = [
        ...(await inspectRenditions(networkResources(urls))),
        ...loadedCaptions,
      ];
      setSession((old) =>
        old
          ? {
              ...old,
              resources: [
                ...old.resources.filter((r) => !r.id.startsWith("network-")),
                ...resources,
              ],
            }
          : old,
      );
      setIds((old) => [
        ...old.filter((id) => !id.startsWith("network-")),
        ...resources.filter((r) => r.status === "available").map((r) => r.id),
      ]);
      setNotice(
        resources.length
          ? `Found ${resources.filter((r) => r.kind === "video").length} video, ${resources.filter((r) => r.kind === "audio").length} audio and ${resources.filter((r) => r.kind === "captions").length} caption candidates. Loaded caption snapshots may be incomplete. If captions are missing, enable them in the player and scan again. HLS is validated at export.`
          : "No supported network URLs visible. Reload and play the lecture, then try again. Cross-origin CDN hosts need site access; opaque or DASH feeds require another adapter.",
      );
    } catch {
      setNotice(
        "Could not inspect playback requests. Reload the extension and lecture, then retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function run(zip: boolean) {
    if (!session) return;
    setBusy(true);
    setNotice("Exporting — keep this page open.");
    setStatus({});
    try {
      const root = filename(session.title);
      let archive:
        | ReturnType<typeof zipSink>
        | ReturnType<typeof streamingZipSink>
        | undefined;
      if (zip) {
        const picker = (
          window as unknown as {
            showSaveFilePicker?: (options: object) => Promise<{
              createWritable: () => Promise<WritableStream<Uint8Array>>;
            }>;
          }
        ).showSaveFilePicker;
        if (picker) {
          const handle = await picker.call(window, {
            suggestedName: `${root}.zip`,
            types: [
              {
                description: "ZIP archive",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
          archive = streamingZipSink(await handle.createWritable());
        } else archive = zipSink();
      }
      await browser.storage.local.set({
        lastJob: { date: new Date().toISOString(), interrupted: true },
      });
      const outcomes = await exportSession(
        session,
        ids,
        archive || {
          write: (path, blob) => download(blob, `${root}/${path}`),
          remote: (path, url) => downloadUrl(url, `${root}/${path}`),
        },
        (id, message) => setStatus((old) => ({ ...old, [id]: message })),
      );
      if (archive) {
        const result = await archive.close();
        if (result instanceof Blob) await download(result, `${root}.zip`);
      }
      const failed = outcomes.filter((o) => o.status === "failed");
      if (failed.length) setIds(failed.map((o) => o.id));
      setNotice(
        failed.length
          ? `Partial export: ${failed.length} failed. Select failed resources and retry.`
          : "Export complete. See the manifest for omitted resources.",
      );
      await browser.storage.local.set({
        lastJob: {
          date: new Date().toISOString(),
          failed: failed.length,
          interrupted: false,
        },
      });
    } catch {
      setNotice("Export interrupted or could not be saved. Retry the export.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <span className="badge">LOCAL ARCHIVE</span>
        <h1>Panopto Archiver</h1>
        <p>Your lectures. Ready for later.</p>
      </header>
      <div role="status" className="notice">
        {notice}
      </div>
      {session && (
        <>
          <h2>{session.title}</h2>
          <p>
            {session.duration
              ? `${Math.round(session.duration / 60)} minutes · `
              : ""}
            {session.resources.filter((r) => r.status === "available").length}{" "}
            exportable · {session.resources.length} detected
          </p>
          <button disabled={busy} onClick={() => void playback()}>
            Find playback streams
          </button>
          {session.resources.some((r) => r.id.startsWith("network-")) && (
            <button disabled={busy} onClick={() => void allowStreamHosts()}>
              Allow detected stream hosts
            </button>
          )}
          <p className="hint">
            Archive only recordings you have permission to export. Non-encrypted
            HLS VOD can be assembled into a .ts video; separate feeds remain
            separate files.
          </p>
          <div className="toolbar">
            <button
              disabled={busy}
              onClick={() =>
                setIds(
                  session.resources
                    .filter((r) => r.status === "available")
                    .map((r) => r.id),
                )
              }
            >
              Select all
            </button>
            <button disabled={busy} onClick={() => setIds([])}>
              Clear
            </button>
          </div>
          <section>
            {session.resources.map((r) => (
              <label className="resource" key={r.id}>
                <input
                  type="checkbox"
                  disabled={busy || r.status !== "available"}
                  checked={ids.includes(r.id)}
                  onChange={(e) =>
                    setIds((old) =>
                      e.target.checked
                        ? [...old, r.id]
                        : old.filter((id) => id !== r.id),
                    )
                  }
                />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind} · {r.format.toUpperCase()} {r.language}{" "}
                    {r.size ? `· ${r.size} bytes` : ""}
                  </small>
                  {r.reason && <small className="warning">{r.reason}</small>}
                  <small>{status[r.id]}</small>
                </span>
              </label>
            ))}
          </section>
          {!session.resources.length && (
            <p>
              The lecture was detected, but this adapter found no supported
              download links. This does not mean downloads are disabled. Open
              the player’s Download or transcript menu, then click Refresh here.
              Scripted controls may require a verified Panopto adapter.
            </p>
          )}
          <p className="hint">{session.warnings.join(" ")}</p>
          <div className="actions">
            <button
              disabled={busy || !ids.length}
              onClick={() => void run(false)}
            >
              Export Folder
            </button>
            <button
              className="primary"
              disabled={busy || !ids.length}
              onClick={() => void run(true)}
            >
              Export ZIP
            </button>
          </div>
          <p className="hint">
            ZIP streams to disk when a save picker is available. Buffered
            fallback limits each resource to 128 MiB. Use Folder for large
            videos. Files are saved under your Downloads directory.
          </p>
        </>
      )}
      <footer>
        <button disabled={busy} onClick={() => void scan()}>
          Refresh
        </button>
        <button disabled={busy} onClick={() => void grant()}>
          Grant custom site access
        </button>
        {!location.pathname.includes("/export") && (
          <button
            disabled={!tabId || busy}
            onClick={() =>
              void browser.tabs.create({
                url:
                  browser.runtime.getURL("/export.html") +
                  `?tab=${tabId || ""}`,
              })
            }
          >
            Open export manager ↗
          </button>
        )}
      </footer>
    </main>
  );
}
