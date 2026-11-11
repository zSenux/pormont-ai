const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  settings: () => ipcRenderer.invoke("jarvis:settings"),
  setServer: (url) => ipcRenderer.invoke("jarvis:setServer", url),
  hideMini: () => ipcRenderer.invoke("jarvis:hideMini"),
});
