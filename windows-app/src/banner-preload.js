const { contextBridge, ipcRenderer } = require("electron");

// Hinweis-Leiste „Jarvis steuert den PC“: nur Text empfangen und Stopp melden
contextBridge.exposeInMainWorld("jarvisBanner", {
  onText: (fn) => ipcRenderer.on("banner:text", (_e, t) => fn(String(t))),
  stop: () => ipcRenderer.send("banner:stop"),
});
