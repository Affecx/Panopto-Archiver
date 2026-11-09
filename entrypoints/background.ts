import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { playbackCandidate } from "../src/network";
export default defineBackground(() => {
  const captures = new Map<number, { time: number; urls: string[] }>();
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0 || !playbackCandidate(details.url)) return;
      const old = captures.get(details.tabId);
      const urls =
        old && Date.now() - old.time < 10 * 60 * 1000 ? old.urls : [];
      if (!urls.includes(details.url)) urls.push(details.url);
      captures.set(details.tabId, { time: Date.now(), urls: urls.slice(-24) });
    },
    { urls: ["https://*/*", "http://localhost/*"] },
  );
  browser.tabs.onRemoved.addListener((id) => captures.delete(id));
  browser.tabs.onUpdated.addListener((id, change) => {
    if (change.status === "loading") captures.delete(id);
  });
  browser.runtime.onMessage.addListener((message, _sender, reply) => {
    if (
      message?.type === "NETWORK_STREAMS" &&
      Number.isInteger(message.tabId)
    ) {
      const capture = captures.get(message.tabId);
      reply({
        urls:
          capture && Date.now() - capture.time < 10 * 60 * 1000
            ? capture.urls
            : [],
      });
    }
    return false;
  });
  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.set({ version: 1 });
  });
});
