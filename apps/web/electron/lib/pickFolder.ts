/** Just what the handler uses of an Electron window and dialog, so it can be tested without Electron. */
export interface PickFolderDeps<W extends { webContents: unknown }> {
  getWindow: () => W | null;
  showOpenDialog: (win: W, options: { properties: ["openDirectory"] }) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * The handler for "locally:pick-folder" (#249). Only the main window's page may ask; anyone else gets null.
 * Resolves to the chosen folder's path, or null when the person cancels.
 */
export function makePickFolderHandler<W extends { webContents: unknown }>(deps: PickFolderDeps<W>) {
  return async (event: { sender: unknown }): Promise<string | null> => {
    const win = deps.getWindow();
    if (!win || event.sender !== win.webContents) return null;
    const result = await deps.showOpenDialog(win, { properties: ["openDirectory"] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  };
}
