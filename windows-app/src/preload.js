const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  settings: () => ipcRenderer.invoke("jarvis:settings"),
  setServer: (url) => ipcRenderer.invoke("jarvis:setServer", url),
  hideMini: () => ipcRenderer.invoke("jarvis:hideMini"),
  pcPoke: () => ipcRenderer.invoke("jarvis:pcPoke"),
  remote: () => ipcRenderer.invoke("jarvis:remote"),
});
