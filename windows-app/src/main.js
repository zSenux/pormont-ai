// Jarvis ProMont für Windows: Hülle um die Web-App (gleiche Anmeldung, gleiche Daten).
// - Hauptfenster = komplette Web-App
// - Strg + Leertaste = kleines Jarvis-Fenster (/fenster) von überall
// - Symbol im Infobereich (Tray), Start mit Windows
// - Computer-Steuerung (remote.js): Jarvis bedient den PC – Aufträge aus dem Chat am PC oder vom Handy (Fernsteuerung)
const { app, BrowserWindow, Tray, Menu, globalShortcut, shell, ipcMain, nativeImage, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SETTINGS = path.join(app.getPath("userData"), "einstellungen.json");
const DEFAULTS = { server: "", shortcut: "Control+Space", autostart: true, deviceId: "", remoteEnabled: false, remoteAsked: false };
const remote = require("./remote");
let settings = load();
let main = null;
let mini = null;
let tray = null;
let quitting = false;

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}
function save() {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}
function normalize(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const p = new URL(u);
    // Nur https, außer für die lokale Entwicklung
    if (p.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(p.hostname)) return "";
    return p.origin;
  } catch {
    return "";
  }
}
const asset = (f) => path.join(__dirname, "assets", f);

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

function isOwn(url) {
  try {
    return settings.server && new URL(url).origin === settings.server;
  } catch {
    return false;
  }
}

// Fremde Links (Lexware, PDFs auf anderen Seiten) im normalen Browser öffnen
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url) && !/\/api\/lexware\/pdf\//.test(url)) {
      win.loadURL(url);
      return { action: "deny" };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isOwn(url) && !url.startsWith("file:")) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function createMain() {
  main = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 520,
    title: "Jarvis ProMont",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#092f50",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  guard(main);
  main.once("ready-to-show", () => main.show());
  main.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      main.hide();
    }
  });
  loadMain();
}

function loadMain() {
  if (!main) return;
  if (settings.server) main.loadURL(settings.server + "/");
  else main.loadFile(path.join(__dirname, "renderer", "setup.html"));
}

function showMain() {
  if (!main) createMain();
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}

function toggleMini() {
  if (!settings.server) return showMain();
  if (mini && mini.isVisible() && mini.isFocused()) return mini.hide();
  if (!mini) {
    mini = new BrowserWindow({
      width: 460,
      height: 640,
      frame: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: "#092f50",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
    });
    guard(mini);
    mini.on("blur", () => mini && !mini.webContents.isDevToolsOpened() && mini.hide());
    mini.on("closed", () => (mini = null));
    mini.loadURL(settings.server + "/fenster");
  }
  const { screen } = require("electron");
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  mini.setPosition(Math.round(area.x + area.width - 480), Math.round(area.y + area.height - 660));
  mini.show();
  mini.focus();
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  // Not-Aus der Computer-Steuerung
  try {
    globalShortcut.register("Control+Alt+Escape", () => remote.emergencyStop());
  } catch {
    /* belegt */
  }
  try {
    if (!globalShortcut.register(settings.shortcut, toggleMini)) console.warn("Tastenkürzel belegt:", settings.shortcut);
  } catch (e) {
    console.warn("Tastenkürzel ungültig:", e.message);
  }
}

function buildTray() {
  const img = nativeImage.createFromPath(asset("tray.png"));
  tray = new Tray(img);
  tray.setToolTip("Jarvis ProMont");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Jarvis öffnen", click: showMain },
      { label: `Schnell fragen (${settings.shortcut.replace("Control", "Strg").replace("Space", "Leertaste")})`, click: toggleMini },
      { type: "separator" },
      { label: "Fernsteuerung vom Handy erlauben", type: "checkbox", checked: settings.remoteEnabled, click: (i) => setRemote(i.checked) },
      ...(remote.state().busy ? [{ label: "Jarvis am PC stoppen (Strg+Alt+Esc)", click: () => remote.emergencyStop() }] : []),
      { type: "separator" },
      { label: "Mit Windows starten", type: "checkbox", checked: settings.autostart, click: (i) => setAutostart(i.checked) },
      { label: "Server-Adresse ändern …", click: () => { settings.server = ""; save(); showMain(); loadMain(); } },
      { type: "separator" },
      { label: "Beenden", click: () => { quitting = true; app.quit(); } },
    ]);
  tray.setContextMenu(menu());
  tray.on("click", showMain);
  tray.on("right-click", () => tray.setContextMenu(menu()));
}

function setRemote(on) {
  settings.remoteEnabled = !!on;
  settings.remoteAsked = true;
  save();
  if (tray) tray.setToolTip(on ? "Jarvis ProMont – Fernsteuerung an" : "Jarvis ProMont");
  remote.poke();
}

/** Einmal fragen, ob Aufträge vom Handy erlaubt sind (Standard: aus) */
async function askRemoteOnce() {
  if (settings.remoteAsked || !settings.server) return;
  settings.remoteAsked = true;
  save();
  const { dialog } = require("electron");
  const r = await dialog.showMessageBox({
    type: "question",
    buttons: ["Ja, erlauben", "Nein"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "Jarvis ProMont",
    message: "Darf Jarvis diesen PC auch vom Handy aus bedienen?",
    detail: "Dann kannst du unterwegs Aufträge an den PC schicken (z. B. „Öffne die Zeichnung Geländer Müller und mach ein Angebot“) und den Bildschirm live sehen. Jeder Auftrag wird vorher am Handy freigegeben. Ändern jederzeit über das Jarvis-Symbol unten rechts.",
  });
  setRemote(r.response === 0);
}

/** Jarvis-Fenster während eines Auftrags aus dem Weg räumen → Rückgabe stellt sie wieder her */
function hideWindows() {
  const wasVisible = main && main.isVisible() && !main.isMinimized();
  if (wasVisible) main.minimize();
  if (mini && mini.isVisible()) mini.hide();
  return () => {
    if (wasVisible && main && !main.isDestroyed()) main.restore();
  };
}

function setAutostart(on) {
  settings.autostart = on;
  save();
  if (process.platform === "win32") app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
}

ipcMain.handle("jarvis:settings", () => ({ server: settings.server, shortcut: settings.shortcut, version: app.getVersion() }));
ipcMain.handle("jarvis:setServer", async (_e, url) => {
  const server = normalize(url);
  if (!server) return { error: "Bitte eine gültige https-Adresse eingeben." };
  try {
    const r = await session.defaultSession.fetch(server + "/api/health", { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.app !== "promont-jarvis") return { error: "Unter dieser Adresse läuft kein Jarvis." };
  } catch {
    return { error: "Server nicht erreichbar." };
  }
  settings.server = server;
  save();
  remote.poke();
  if (mini) { mini.destroy(); mini = null; }
  loadMain();
  return { ok: true };
});
ipcMain.handle("jarvis:hideMini", () => mini && mini.hide());
// Web-App meldet einen neuen Auftrag am PC → sofort abholen
ipcMain.handle("jarvis:pcPoke", () => remote.poke());
ipcMain.handle("jarvis:remote", () => ({ enabled: settings.remoteEnabled, ...remote.state() }));
ipcMain.on("banner:stop", () => remote.emergencyStop());

app.whenReady().then(() => {
  app.setAppUserModelId("gmbh.promont.jarvis");
  // Erkennungsmerkmal für die Web-App (z. B. kompakte Darstellung)
  session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + " JarvisPromont/" + app.getVersion());
  // Mikrofon für Diktat und Benachrichtigungen nur für den eigenen Server erlauben
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(isOwn(wc.getURL()) && ["media", "notifications", "clipboard-sanitized-write"].includes(permission));
  });
  buildTray();
  registerShortcut();
  setAutostart(settings.autostart);
  if (!process.argv.includes("--hidden")) showMain();
  else createMain();
  remote.init({
    getSettings: () => settings,
    saveSettings: (p) => {
      Object.assign(settings, p);
      save();
    },
    session: session.defaultSession,
    hideWindows,
  });
  // Nach dem ersten erfolgreichen Anmelden einmal nach der Fernsteuerung fragen
  setTimeout(() => askRemoteOnce().catch(() => {}), 20_000);
});

app.on("window-all-closed", (e) => e.preventDefault());
app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());
