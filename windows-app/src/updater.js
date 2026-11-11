// Automatische Updates: neue Versionen kommen als GitHub-Release (zSenux/pormont-ai, Datei latest.yml).
// Prüfung beim Start und alle 6 Std., Download im Hintergrund, Installation beim Beenden
// oder sofort per Klick in der Mitteilung. electron-updater prüft die SHA-512-Prüfsumme aus latest.yml.
const { app, Notification, dialog } = require("electron");

let updater = null;
let ready = null; // Version, die fertig heruntergeladen ist
let onChange = () => {};

function log(...a) {
  console.log("[update]", ...a);
}

function init({ changed } = {}) {
  if (changed) onChange = changed;
  // Nur in der installierten App (beim Entwickeln gibt es nichts zu aktualisieren)
  if (!app.isPackaged) return;
  ({ autoUpdater: updater } = require("electron-updater"));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = { info: log, warn: log, error: log, debug: () => {} };
  updater.on("update-downloaded", (info) => {
    ready = info.version;
    onChange();
    const n = new Notification({
      title: "Jarvis-Update bereit",
      body: `Version ${info.version} ist geladen. Klicken zum Neustarten – sonst wird sie beim nächsten Beenden installiert.`,
    });
    n.on("click", () => installNow());
    n.show();
  });
  updater.on("error", (e) => log("Fehler:", e?.message || e));
  setTimeout(check, 30_000);
  setInterval(check, 6 * 60 * 60_000);
}

function check() {
  if (!updater) return Promise.resolve(null);
  return updater.checkForUpdates().catch((e) => {
    log("Prüfung fehlgeschlagen:", e?.message || e);
    return null;
  });
}

/** Klick im Tray: prüfen und Ergebnis anzeigen */
async function checkInteractive() {
  if (!updater) {
    dialog.showMessageBox({ type: "info", title: "Jarvis", message: "Updates gibt es nur in der installierten App." });
    return;
  }
  if (ready) return installNow();
  const r = await check();
  const latest = r?.updateInfo?.version;
  if (!r || !latest || latest === app.getVersion() || !r.isUpdateAvailable) {
    dialog.showMessageBox({ type: "info", title: "Jarvis", message: `Jarvis ist aktuell (Version ${app.getVersion()}).` });
  } else {
    dialog.showMessageBox({ type: "info", title: "Jarvis", message: `Version ${latest} wird im Hintergrund geladen. Du bekommst eine Mitteilung, sobald sie bereit ist.` });
  }
}

function installNow() {
  if (!updater || !ready) return;
  app.emit("before-quit"); // Fenster dürfen sich schließen
  // still installieren und danach wieder starten
  updater.quitAndInstall(true, true);
}

const state = () => ({ version: app.getVersion(), ready });

module.exports = { init, check, checkInteractive, installNow, state };
