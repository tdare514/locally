import { describe, expect, it, vi } from "vitest";
import { makePickFolderHandler } from "../../../electron/lib/pickFolder";

function setup(result: { canceled: boolean; filePaths: string[] }) {
  const win = { webContents: { id: 1 } };
  const showOpenDialog = vi.fn(async () => result);
  const handler = makePickFolderHandler({ getWindow: () => win, showOpenDialog });
  return { win, showOpenDialog, handler };
}

describe("pick-folder handler", () => {
  it("opens a folder-only dialog on the main window and returns the first path", async () => {
    const { win, showOpenDialog, handler } = setup({ canceled: false, filePaths: ["/Users/x/Masters", "/other"] });
    expect(await handler({ sender: win.webContents })).toBe("/Users/x/Masters");
    expect(showOpenDialog).toHaveBeenCalledWith(win, { properties: ["openDirectory"] });
  });

  it("returns null when the person cancels or picks nothing", async () => {
    expect(await setup({ canceled: true, filePaths: ["/a"] }).handler({ sender: { id: 1 } })).toBeNull();
    const s = setup({ canceled: false, filePaths: [] });
    expect(await s.handler({ sender: s.win.webContents })).toBeNull();
  });

  it("refuses a sender that is not the main window, without opening a dialog", async () => {
    const { showOpenDialog, handler } = setup({ canceled: false, filePaths: ["/a"] });
    expect(await handler({ sender: { id: 2 } })).toBeNull();
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it("returns null when there is no main window", async () => {
    const showOpenDialog = vi.fn();
    const handler = makePickFolderHandler({ getWindow: () => null, showOpenDialog });
    expect(await handler({ sender: {} })).toBeNull();
    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});

describe("preload", () => {
  it("exposes only locallyDesktop.pickFolder, over the one channel", async () => {
    const exposed: Record<string, Record<string, () => Promise<unknown>>> = {};
    const invoke = vi.fn(async () => "/picked");
    vi.resetModules();
    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld: (name: string, api: never) => (exposed[name] = api) },
      ipcRenderer: { invoke },
    }));
    await import("../../../electron/preload");
    expect(Object.keys(exposed)).toEqual(["locallyDesktop"]);
    expect(Object.keys(exposed.locallyDesktop)).toEqual(["pickFolder"]);
    expect(await exposed.locallyDesktop.pickFolder()).toBe("/picked");
    expect(invoke).toHaveBeenCalledWith("locally:pick-folder");
  });
});
