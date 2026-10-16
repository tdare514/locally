import { contextBridge, ipcRenderer } from "electron";

// The one thing the page may ask of the desktop shell: a native folder picker (#249).
// Resolves to the chosen folder's path, or null when the person cancels.
contextBridge.exposeInMainWorld("locallyDesktop", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("locally:pick-folder"),
});
