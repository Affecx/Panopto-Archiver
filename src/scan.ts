import { browser } from "wxt/browser";
import type { Session } from "./types";

/** Use frame-specific replies so a Moodle wrapper cannot mask its viewer. */
export async function scanTab(tabId: number): Promise<Session | undefined> {
  const read = async (frameId?: number): Promise<Session | undefined> => {
    try {
      const response = await browser.tabs.sendMessage(
        tabId,
        { type: "DISCOVER" },
        frameId === undefined ? undefined : { frameId },
      );
      return response?.session;
    } catch {
      return undefined;
    }
  };
  const existing = await read();
  if (existing) return existing;
  const frames = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["/content-scripts/content.js"],
  });
  const sessions = await Promise.all(
    frames.map((frame) => read(frame.frameId)),
  );
  return sessions.find((session): session is Session => !!session);
}
