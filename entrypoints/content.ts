import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { loadedCaptionResources } from "../src/browser-captions";
import { playbackCandidate } from "../src/network";
import { discover } from "../src/discovery";
export default defineContentScript({
  matches: [
    "https://*.panopto.com/*",
    "https://*.panopto.eu/*",
    "https://*.panopto.cloud/*",
    "http://localhost/*",
  ],
  allFrames: true,
  main() {
    const state = globalThis as typeof globalThis & {
      __panoptoArchiverInstalled?: boolean;
    };
    if (state.__panoptoArchiverInstalled) return;
    state.__panoptoArchiverInstalled = true;
    browser.runtime.onMessage.addListener((message, _sender, reply) => {
      if (message?.type === "PLAYBACK_URLS") {
        const entries = performance
          .getEntriesByType("resource")
          .map((e) => e.name);
        const media = [
          ...document.querySelectorAll<HTMLMediaElement>(
            "video,audio,source,track[src]",
          ),
        ].map((e) => e.currentSrc || e.getAttribute("src") || "");
        reply({
          captions: loadedCaptionResources(document),
          urls: [
            ...new Set([...entries, ...media].filter(playbackCandidate)),
          ].slice(-24),
        });
      }
      if (message?.type === "DISCOVER") {
        try {
          reply({ session: discover(document, location.href) });
        } catch {
          // A non-lecture wrapper must not race an embedded viewer response.
        }
      }
      return false;
    });
  },
});
