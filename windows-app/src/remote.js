// Jarvis am PC: Lebenszeichen, Aufträge abarbeiten, Freigaben, Live-Bild, Hinweis-Leiste mit Not-Aus.
// Anmeldung = Sitzung der Web-App im Hauptfenster (gleiches Cookie), kein eigener Schlüssel.
const { app, BrowserWindow, dialog, screen } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { computer, pcTool, preview, PASSIVE } = require("./computer");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOT_EXECUTED = "Not executed: an earlier computer action in this turn failed.";

/** @type {{ getSettings: () => any, saveSettings: (p: object) => void, session: Electron.Session, hideWindows: () => () => void }} */
let host = null;
let job = null; // { id, origin, abort, control: null|true|false }
let viewing = false;
let banner = null;
let beatTimer = null;
let lastBeatOk = false;

// ---------- Server ----------

async function api(pathname, { method = "GET", body } = {}) {
  const { server } = host.getSettings();
  if (!server) throw new Error("Kein Server eingestellt.");
  const res = await host.session.fetch(server + pathname, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function upload(file, projectId) {
  const { server } = host.getSettings();
  const form = new FormData();
  const type = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv" }[path.extname(file).toLowerCase()] || "application/octet-stream";
  form.append("file", new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  form.append("name", path.basename(file));
  if (projectId) form.append("projectId", String(projectId));
  const res = await host.session.fetch(server + "/api/pc/upload", { method: "POST", body: form, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Hochladen fehlgeschlagen.");
  return `In Jarvis unter Dokumente abgelegt: ${data.name || path.basename(file)} (ID ${data.id}).`;
}

// ---------- Lebenszeichen ----------

function schedule(ms) {
  clearTimeout(beatTimer);
  beatTimer = setTimeout(beat, ms);
}

async function beat() {
  const s = host.getSettings();
  try {
    if (!s.server) return;
    const r = await api("/api/pc/heartbeat", {
      method: "POST",
      body: {
        deviceId: s.deviceId,
        name: s.deviceName || os.hostname(),
        remoteEnabled: !!s.remoteEnabled,
        status: { version: app.getVersion(), os: `${os.type()} ${os.release()}`, screens: screen.getAllDisplays().length, user: os.userInfo().username },
        busy: job ? [job.id] : [],
      },
    });
    lastBeatOk = true;
    if (job && r.stopped?.includes(job.id)) job.abort = "Am Handy/Browser gestoppt.";
    if (r.job && !job) runJob(r.job);
    if (r.view && !viewing) startView();
    if (!r.view) viewing = false;
  } catch (e) {
    lastBeatOk = false;
    if (e.status !== 401) console.warn("[pc] Lebenszeichen:", e.message);
  } finally {
    // mit erlaubter Fernsteuerung oder laufendem Auftrag öfter melden
    schedule(s.remoteEnabled || job ? 3000 : 8000);
  }
}

/** Sofort melden (z. B. nach einem neuen Auftrag aus dem Chat am PC) */
function poke() {
  schedule(200);
}

// ---------- Live-Bild ----------

async function startView() {
  viewing = true;
  while (viewing && host.getSettings().remoteEnabled) {
    try {
      const r = await api("/api/pc/view", { method: "POST", body: { deviceId: host.getSettings().deviceId, image: await preview(1280, 55) } });
      if (r.stop) break;
    } catch {
      break;
    }
    await sleep(1500);
  }
  viewing = false;
}

// ---------- Hinweis-Leiste mit Not-Aus ----------

function showBanner(text) {
  if (!banner) {
    const area = screen.getPrimaryDisplay().workArea;
    banner = new BrowserWindow({
      width: 460,
      height: 46,
      x: Math.round(area.x + area.width / 2 - 230),
      y: area.y + 6,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, "banner-preload.js"), contextIsolation: true, sandbox: true },
    });
    banner.setAlwaysOnTop(true, "screen-saver");
    // Leiste erscheint nicht auf Bildschirmfotos → Jarvis sieht den Bildschirm ohne sie
    banner.setContentProtection(true);
    banner.loadFile(path.join(__dirname, "renderer", "banner.html"));
    banner.on("closed", () => (banner = null));
    banner.once("ready-to-show", () => banner && banner.showInactive());
  } else if (!banner.isVisible()) banner.showInactive();
  banner.webContents.send("banner:text", text);
}

function hideBanner() {
  if (banner) banner.destroy();
  banner = null;
}

/** Klickt Jarvis dorthin, wo die Leiste liegt, geht sie kurz aus dem Weg */
async function beforePoint(p) {
  if (!banner || !banner.isVisible()) return;
  const s = screen.getPrimaryDisplay().scaleFactor || 1;
  const b = banner.getBounds();
  const x = p.x / s;
  const y = p.y / s;
  if (x >= b.x - 10 && x <= b.x + b.width + 10 && y >= b.y - 10 && y <= b.y + b.height + 10) {
    banner.hide();
    setTimeout(() => job && banner && banner.showInactive(), 2500);
  }
}

/** Not-Aus: Strg+Alt+Esc oder „Stopp“ in der Leiste */
function emergencyStop() {
  if (!job) return;
  job.abort = "Am PC gestoppt.";
  api(`/api/pc/jobs/${job.id}/cancel`, { method: "POST", body: {} }).catch(() => {});
  hideBanner();
}

// ---------- Freigabe von Maus/Tastatur (einmal je Auftrag) ----------

async function askControl(prompt) {
  const text = "Darf Jarvis für diesen Auftrag Maus, Tastatur, Programme und Dateien am PC bedienen?";
  const detail = `Auftrag: ${prompt.slice(0, 600)}\n\nJarvis tippt keine Passwörter oder Bankdaten, löscht nichts endgültig und sendet nichts ohne dich. Stoppen jederzeit mit Strg+Alt+Esc.`;
  if (job.origin === "pc") {
    const r = await dialog.showMessageBox({ type: "question", buttons: ["Erlauben", "Ablehnen"], defaultId: 0, cancelId: 1, title: "Jarvis am PC", message: text, detail, noLink: true });
    const yes = r.response === 0;
    api(`/api/pc/jobs/${job.id}/confirm`, { method: "POST", body: { text, detail, control: true, answer: yes ? "yes" : "no" } }).catch(() => {});
    return yes;
  }
  // Auftrag vom Handy/Browser: Freigabe dort (Push) – hier warten, max. 10 min
  await api(`/api/pc/jobs/${job.id}/confirm`, { method: "POST", body: { text, detail, control: true } });
  showBanner("Wartet auf Freigabe am Handy …");
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until && !job.abort) {
    await sleep(2000);
    const j = await api(`/api/pc/jobs/${job.id}`).catch(() => null);
    if (!j) continue;
    if (!["RUNNING", "CONFIRM"].includes(j.status)) {
      job.abort = "Auftrag beendet.";
      return false;
    }
    if (j.status === "RUNNING" && j.decision) return j.decision === "yes";
  }
  if (!job.abort) job.abort = "Keine Freigabe innerhalb von 10 Minuten.";
  return false;
}

// ---------- Auftrag abarbeiten ----------

function label(call) {
  const i = call.input || {};
  if (call.toolset === "computer") {
    return {
      screenshot: "schaut auf den Bildschirm",
      zoom: "sieht genauer hin",
      type: "tippt",
      key: `drückt ${i.text || "Taste"}`,
      scroll: "scrollt",
      left_click_drag: "zieht mit der Maus",
      wait: "wartet",
    }[call.name] || "klickt";
  }
  return { pc_programm_starten: `startet ${i.name}`, pc_fenster: "wechselt das Fenster", pc_dateien_suchen: `sucht „${i.suche}“`, pc_ordner: "schaut in einen Ordner", pc_datei_oeffnen: "öffnet eine Datei", pc_datei_ansehen: "liest eine Datei", pc_datei_hochladen: "lädt eine Datei hoch" }[call.name] || call.name;
}

async function runCall(call) {
  const passive = call.toolset === "computer" ? PASSIVE.has(call.name) : ["pc_fenster", "pc_dateien_suchen", "pc_ordner"].includes(call.name) && call.input?.aktion !== "vorne";
  if (!passive && job.control === null) job.control = await askControl(job.prompt);
  if (job.abort) return { id: call.id, text: "Abgebrochen.", isError: true };
  if (!passive && !job.control) return { id: call.id, text: "Der Nutzer hat die Bedienung des PCs für diesen Auftrag abgelehnt. Nicht erneut versuchen – sag, was du ohne Bedienung tun kannst.", isError: true };
  showBanner(`Jarvis ${label(call)} …`);
  const r = call.toolset === "computer" ? await computer(call.name, call.input, { beforePoint }) : await pcTool(call.name, call.input, { upload });
  return { id: call.id, ...r };
}

async function runJob(j) {
  job = { id: j.id, origin: j.origin, prompt: j.prompt, abort: null, control: null };
  const restore = host.hideWindows(); // Jarvis-Fenster aus dem Weg, damit der Bildschirm frei ist
  showBanner("Jarvis übernimmt …");
  let results;
  let shot;
  try {
    for (let step = 0; step < 200; step++) {
      if (job.abort) break;
      const r = await api(`/api/pc/jobs/${job.id}/step`, { method: "POST", body: { results, screenshot: shot } });
      if (r.done || !Array.isArray(r.pending)) break;
      results = [];
      let failed = false;
      for (const call of r.pending) {
        if (job.abort) {
          results.push({ id: call.id, text: "Abgebrochen.", isError: true });
          continue;
        }
        if (failed && call.toolset === "computer") {
          results.push({ id: call.id, text: NOT_EXECUTED, isError: true });
          continue;
        }
        try {
          results.push(await runCall(call));
        } catch (e) {
          if (call.toolset === "computer") failed = true;
          results.push({ id: call.id, text: String(e?.message || e).slice(0, 800), isError: true });
        }
      }
      shot = await preview(960, 50).catch(() => undefined);
    }
  } catch (e) {
    console.warn("[pc] Auftrag:", e.message);
  } finally {
    hideBanner();
    restore();
    job = null;
    poke();
  }
}

function init(h) {
  host = h;
  const s = host.getSettings();
  if (!s.deviceId) host.saveSettings({ deviceId: require("node:crypto").randomUUID() });
  schedule(1500);
}

const state = () => ({ busy: !!job, online: lastBeatOk });

module.exports = { init, poke, emergencyStop, state, showBanner, hideBanner };
