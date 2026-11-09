import { beforeEach, expect, it, vi } from "vitest";
const { sendMessage, executeScript } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  executeScript: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: { tabs: { sendMessage }, scripting: { executeScript } },
}));
import { scanTab } from "../src/scan";
const session = {
  id: "example",
  title: "Example",
  resources: [],
  warnings: [],
};
beforeEach(() => {
  vi.resetAllMocks();
});
it("uses an existing content script without reinjection", async () => {
  sendMessage.mockResolvedValue({ session });
  expect(await scanTab(12)).toEqual(session);
  expect(executeScript).not.toHaveBeenCalled();
});
it("attaches to an already-open tab when the content script is missing", async () => {
  sendMessage
    .mockRejectedValueOnce(new Error("No receiver"))
    .mockResolvedValueOnce({ session });
  executeScript.mockResolvedValue([{ frameId: 0 }]);
  expect(await scanTab(12)).toEqual(session);
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 12, allFrames: true },
    files: ["/content-scripts/content.js"],
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
it("reports no lecture separately from an injection permission failure", async () => {
  sendMessage.mockResolvedValue(undefined);
  executeScript.mockResolvedValue([]);
  expect(await scanTab(12)).toBeUndefined();
  executeScript.mockRejectedValue(new Error("Permission denied"));
  await expect(scanTab(12)).rejects.toThrow("Permission denied");
});

it("routes discovery to embedded frames when the wrapper provides no lecture", async () => {
  sendMessage
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ session });
  executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 7 }]);
  expect(await scanTab(12)).toEqual(session);
  expect(sendMessage).toHaveBeenCalledWith(
    12,
    { type: "DISCOVER" },
    { frameId: 7 },
  );
});
