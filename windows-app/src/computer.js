// Computer-Steuerung: führt die Werkzeug-Aufrufe aus, die Jarvis vom Server schickt.
// - Computer-Toolset von Claude (screenshot, zoom, Klicks, Tippen, Tasten …) – Koordinaten im Bild des letzten Bildschirmfotos
// - pc_*-Werkzeuge: Programme, Fenster, Dateien (nur im Benutzerordner)
// Regeln: nie Passwörter/Bank-/Kartendaten tippen, nie in Passwortfelder tippen, nichts endgültig löschen (Umschalt+Entf gesperrt).
const { clipboard, desktopCapturer, screen, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const win = require("./win");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Bildschirmfoto + Umrechnung ----------

/** Zuletzt an Claude geschicktes Bild: Größe + Bildschirm (für die Umrechnung der Koordinaten) */
let last = null;

/** Bildgröße, die die API ohne Verkleinern annimmt (lange Kante ≤ 1568, ≤ 1,15 Megapixel) */
function apiScale(w, h) {
  return Math.min(1, 1568 / Math.max(w, h), Math.sqrt(1_150_000 / (w * h)));
}

/** Hauptbildschirm in voller (physischer) Auflösung */
async function capture() {
  const display = screen.getPrimaryDisplay();
  const s = display.scaleFactor || 1;
  const size = { width: Math.round(display.size.width * s), height: Math.round(display.size.height * s) };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const src = sources.find((x) => String(x.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error("Bildschirmfoto nicht möglich (Bildschirm gesperrt?).");
  return { img: src.thumbnail, display };
}

async function screenshot() {
  const { img, display } = await capture();
  const { width, height } = img.getSize();
  const f = apiScale(width, height);
  const w = Math.round(width * f);
  const h = Math.round(height * f);
  const small = f < 1 ? img.resize({ width: w, height: h, quality: "best" }) : img;
  last = { w, h, full: { w: width, h: height }, display };
  return { text: `Bildschirmfoto ${w}×${h}.`, image: small.toJPEG(80).toString("base64"), imageType: "image/jpeg" };
}

/** Kleines Bild für die Seite /pc bzw. das Live-Bild am Handy */
async function preview(maxW = 1280, quality = 60) {
  const { img } = await capture();
  const { width } = img.getSize();
  const small = width > maxW ? img.resize({ width: maxW, quality: "good" }) : img;
  return small.toJPEG(quality).toString("base64");
}

/** Bild-Koordinaten → physische Bildschirm-Pixel für user32 */
function toScreen(coord) {
  if (!last) throw new Error("Erst ein screenshot – Koordinaten beziehen sich auf das letzte Bildschirmfoto.");
  if (!Array.isArray(coord) || coord.length !== 2) throw new Error("coordinate muss [x, y] sein.");
  const [x, y] = coord.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > last.w || y > last.h) throw new Error(`Koordinaten außerhalb des Bildschirmfotos (${last.w}×${last.h}).`);
  const { display } = last;
  const s = display.scaleFactor || 1;
  return { x: (display.bounds.x + (x * display.bounds.width) / last.w) * s, y: (display.bounds.y + (y * display.bounds.height) / last.h) * s };
}

/** Physische Pixel → Bild-Koordinaten (für cursor_position) */
function fromScreen(p) {
  if (!last) return p;
  const { display } = last;
  const s = display.scaleFactor || 1;
  return { x: Math.round(((p.x / s - display.bounds.x) * last.w) / display.bounds.width), y: Math.round(((p.y / s - display.bounds.y) * last.h) / display.bounds.height) };
}

async function zoom(region) {
  if (!Array.isArray(region) || region.length !== 4) throw new Error("region muss [x0, y0, x1, y1] sein.");
  if (!last) await screenshot();
  const [x0, y0, x1, y1] = region.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) throw new Error("Ungültiger Bereich.");
  const { img } = await capture();
  const fx = last.full.w / last.w;
  const fy = last.full.h / last.h;
  const rect = { x: Math.max(0, Math.round(x0 * fx)), y: Math.max(0, Math.round(y0 * fy)), width: Math.round((x1 - x0) * fx), height: Math.round((y1 - y0) * fy) };
  rect.width = Math.max(1, Math.min(rect.width, last.full.w - rect.x));
  rect.height = Math.max(1, Math.min(rect.height, last.full.h - rect.y));
  let part = img.crop(rect);
  const f = apiScale(rect.width, rect.height);
  if (f < 1) part = part.resize({ width: Math.round(rect.width * f), height: Math.round(rect.height * f), quality: "best" });
  return { text: `Ausschnitt ${region.join(", ")} vergrößert (gleiche Koordinaten wie im Bildschirmfoto).`, image: part.toPNG().toString("base64"), imageType: "image/png" };
}

// ---------- Sicherheit beim Tippen ----------

function luhn(s) {
  const d = s.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

function forbiddenText(t) {
  if (/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,8}\b/.test(t)) return "IBAN";
  if ((t.match(/\b\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b/g) || []).some(luhn)) return "Kartennummer";
  if (/(passwor|kennwort|pin|tan)\s*[:=]/i.test(t)) return "Passwort";
  return null;
}

async function typeText(text) {
  const t = String(text ?? "");
  if (!t) return "Nichts zu tippen.";
  const bad = forbiddenText(t);
  if (bad) throw new Error(`Jarvis tippt keine ${bad === "Passwort" ? "Passwörter/PINs" : bad + "s"} – das macht der Mensch selbst.`);
  if (await win.focusedIsPassword()) throw new Error("Das Feld vorne ist ein Passwortfeld – dort tippt Jarvis nichts ein.");
  // Über die Zwischenablage: schnell, Umlaute/Sonderzeichen unabhängig vom Tastaturlayout
  const old = clipboard.readText();
  clipboard.writeText(t);
  await win.keys([[0x11, 0], [0x56, 0]]);
  await sleep(350);
  clipboard.writeText(old);
  return "Getippt.";
}

function combos(text) {
  // xdotool-Stil: mehrere Kombinationen durch Leerzeichen getrennt („ctrl+a Delete“)
  const list = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!list.length) throw new Error("Keine Taste angegeben.");
  for (const c of list) {
    const lc = c.toLowerCase();
    if (/shift/.test(lc) && /(delete|entf|del)\b/.test(lc)) throw new Error("Umschalt+Entf (endgültig löschen) ist gesperrt.");
  }
  return list.map((c) => win.parseCombo(c));
}

// ---------- Computer-Toolset ----------

/** Aktionen ohne Folgen (brauchen keine Freigabe) */
const PASSIVE = new Set(["screenshot", "zoom", "cursor_position", "wait"]);

/**
 * Ein Aufruf des Computer-Toolsets.
 * hooks.beforePoint(x, y) – z. B. Hinweis-Leiste ausblenden, wenn dort geklickt wird
 */
async function computer(name, input, hooks = {}) {
  const i = input || {};
  const at = async (coord) => {
    if (!coord) return null;
    const p = toScreen(coord);
    await hooks.beforePoint?.(p);
    return p;
  };
  const mods = () => (i.text ? win.parseCombo(String(i.text)) : []);
  switch (name) {
    case "screenshot":
      return screenshot();
    case "zoom":
      return zoom(i.region);
    case "cursor_position": {
      const p = fromScreen(await win.cursorPos());
      return { text: `Mauszeiger bei ${p.x}, ${p.y}.` };
    }
    case "wait": {
      const s = Math.max(0, Math.min(30, Number(i.duration) || 1));
      await sleep(s * 1000);
      return { text: `${s} s gewartet.` };
    }
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click": {
      const p = (await at(i.coordinate)) || (await win.cursorPos());
      const button = name === "right_click" ? "right" : name === "middle_click" ? "middle" : "left";
      const n = name === "double_click" ? 2 : name === "triple_click" ? 3 : 1;
      await win.clickN(p.x, p.y, button, n, mods());
      await sleep(250);
      return { text: "Geklickt." };
    }
    case "mouse_move": {
      const p = await at(i.coordinate);
      if (!p) throw new Error("coordinate fehlt.");
      await win.moveTo(p.x, p.y);
      return { text: "Maus bewegt." };
    }
    case "left_click_drag": {
      const a = await at(i.start_coordinate);
      const b = await at(i.coordinate);
      if (!a || !b) throw new Error("start_coordinate und coordinate nötig.");
      await win.drag(a.x, a.y, b.x, b.y);
      return { text: "Gezogen." };
    }
    case "left_mouse_down":
      await win.mouseButton(true);
      return { text: "Maustaste gedrückt." };
    case "left_mouse_up":
      await win.mouseButton(false);
      return { text: "Maustaste losgelassen." };
    case "scroll": {
      const p = (await at(i.coordinate)) || (await win.cursorPos());
      const n = Math.max(1, Math.min(30, Number(i.scroll_amount) || 3));
      const dir = String(i.scroll_direction || "down");
      const dy = dir === "down" ? n : dir === "up" ? -n : 0;
      const dx = dir === "right" ? n : dir === "left" ? -n : 0;
      const m = mods();
      if (m.length) {
        // Strg/Umschalt + Rad: Modifikator halten, während gescrollt wird
        await win.ps(
          `$m=@(); foreach($p in $env:JV_M.Split(",")){ $m+=[byte][int]$p }; foreach($k in $m){ [KW]::keybd_event($k,0,0,[UIntPtr]::Zero) }
[void][KW]::SetCursorPos([int]$env:JV_X,[int]$env:JV_Y); Start-Sleep -Milliseconds 50; [KW]::mouse_event(0x0800,0,0,[int]$env:JV_V,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50
for($i=$m.Count-1;$i -ge 0;$i--){ [KW]::keybd_event($m[$i],0,2,[UIntPtr]::Zero) }`,
          { JV_M: m.map(([vk]) => vk).join(","), JV_X: String(Math.round(p.x)), JV_Y: String(Math.round(p.y)), JV_V: String(-dy * 120) },
        );
      } else await win.wheel(p.x, p.y, dy, dx);
      await sleep(200);
      return { text: "Gescrollt." };
    }
    case "type":
      return { text: await typeText(i.text) };
    case "key": {
      const list = combos(i.text);
      const rep = Math.max(1, Math.min(50, Number(i.repeat) || 1));
      for (let r = 0; r < rep; r++) for (const k of list) await win.keys(k);
      await sleep(200);
      return { text: "Taste gedrückt." };
    }
    case "hold_key": {
      const list = combos(i.text);
      await win.holdKeys(list[0], Number(i.duration) || 0.5);
      return { text: "Taste gehalten." };
    }
    default:
      throw new Error(`Aktion „${name}“ kennt die Windows-App nicht.`);
  }
}

// ---------- pc_*-Werkzeuge ----------

const HOME = os.homedir();
const BLOCKED = /[\\/](AppData|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|ntuser)/i;

/** Pfad muss im Benutzerordner liegen (ohne AppData & Co.) */
function safePath(p) {
  const raw = String(p || "").trim().replace(/^"|"$/g, "");
  if (!raw) throw new Error("Pfad fehlt.");
  const full = path.resolve(raw.replace(/^~(?=$|[\\/])/, HOME));
  const rel = path.relative(HOME, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Nur Dateien im eigenen Benutzerordner (Dokumente, Desktop, Downloads, OneDrive …).");
  if (BLOCKED.test(full)) throw new Error("Dieser Ordner ist gesperrt.");
  return full;
}

const SEARCH_ROOTS = () => {
  const r = ["Desktop", "Documents", "Downloads", "Pictures"].map((d) => path.join(HOME, d));
  for (const name of fs.existsSync(HOME) ? fs.readdirSync(HOME) : []) if (/^OneDrive/i.test(name)) r.push(path.join(HOME, name));
  return r.filter((d) => fs.existsSync(d));
};

function walk(root, words, ext, out, limit = 40, depth = 0, budget = { n: 0 }) {
  if (out.length >= limit || depth > 8 || budget.n > 60_000) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    budget.n++;
    if (out.length >= limit) return;
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!BLOCKED.test(full)) walk(full, words, ext, out, limit, depth + 1, budget);
      continue;
    }
    const lower = e.name.toLowerCase();
    if (ext && !lower.endsWith("." + ext)) continue;
    if (words.every((w) => lower.includes(w))) {
      try {
        const st = fs.statSync(full);
        out.push({ full, size: st.size, mtime: st.mtime });
      } catch {
        /* weg */
      }
    }
  }
}

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (d) => d.toLocaleDateString("de-DE");

const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const TEXT = /\.(txt|csv|md|json|xml|dxf|log|ini|html?|tsv|nc|gcode|step|stp|iges|igs)$/i;

async function pcTool(name, input, ctx) {
  const i = input || {};
  switch (name) {
    case "pc_programm_starten": {
      const n = String(i.name || "").trim().slice(0, 80);
      if (!n) throw new Error("Programmname fehlt.");
      await win.keys([[0x5b, 0]]); // Windows-Taste → Startmenü-Suche
      await sleep(700);
      await typeText(n);
      await sleep(900);
      await win.keys([[0x0d, 0]]);
      await sleep(2500);
      return { text: `„${n}“ über die Windows-Suche gestartet. Mit screenshot prüfen, ob das richtige Programm offen ist.` };
    }
    case "pc_fenster": {
      if (i.aktion === "vorne") {
        if (!i.titel) throw new Error("titel fehlt.");
        const r = await win.front(i.titel);
        await sleep(400);
        return { text: r === "nicht gefunden" ? `Kein Fenster mit „${i.titel}“ gefunden.` : `Vorne: ${r.replace("\t", " – ")}` };
      }
      const list = await win.windows();
      return { text: list.length ? list.map((w) => `- ${w.app}: ${w.title}`).join("\n") : "Keine offenen Fenster." };
    }
    case "pc_dateien_suchen": {
      const words = String(i.suche || "").toLowerCase().split(/\s+/).filter(Boolean);
      const ext = String(i.endung || "").toLowerCase().replace(/^\./, "");
      if (!words.length && !ext) throw new Error("Suchbegriff fehlt.");
      const roots = i.ordner ? [safePath(i.ordner)] : SEARCH_ROOTS();
      const out = [];
      for (const r of roots) walk(r, words, ext, out);
      out.sort((a, b) => b.mtime - a.mtime);
      return { text: out.length ? out.map((f) => `- ${f.full} (${kb(f.size)}, ${day(f.mtime)})`).join("\n") : "Nichts gefunden." };
    }
    case "pc_ordner": {
      const dir = safePath(i.pfad);
      const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).slice(0, 200);
      const lines = entries.map((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return `- [Ordner] ${e.name}`;
        try {
          const st = fs.statSync(full);
          return `- ${e.name} (${kb(st.size)}, ${day(st.mtime)})`;
        } catch {
          return `- ${e.name}`;
        }
      });
      return { text: `${dir}\n${lines.join("\n") || "(leer)"}` };
    }
    case "pc_datei_oeffnen": {
      const p = safePath(i.pfad);
      if (!fs.existsSync(p)) throw new Error("Datei/Ordner nicht gefunden.");
      if (/\.(exe|bat|cmd|ps1|vbs|js|msi|scr|lnk|reg|com|hta)$/i.test(p)) throw new Error("Programme und Skripte startet Jarvis nicht über Dateien – pc_programm_starten nutzen.");
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
      await sleep(2500);
      return { text: "Geöffnet. Mit screenshot prüfen." };
    }
    case "pc_datei_ansehen": {
      const p = safePath(i.pfad);
      const st = fs.statSync(p);
      if (!st.isFile()) throw new Error("Keine Datei.");
      const ext = path.extname(p).toLowerCase();
      if (ext === ".pdf") {
        if (st.size > 20 * 1024 * 1024) throw new Error("PDF größer als 20 MB.");
        return { text: `PDF ${path.basename(p)} (${kb(st.size)})`, pdf: fs.readFileSync(p).toString("base64") };
      }
      if (MIME[ext] && ext !== ".pdf") {
        if (st.size > 20 * 1024 * 1024) throw new Error("Bild größer als 20 MB.");
        const { nativeImage } = require("electron");
        let img = nativeImage.createFromPath(p);
        if (img.isEmpty()) throw new Error("Bild nicht lesbar.");
        const { width, height } = img.getSize();
        const f = apiScale(width, height);
        if (f < 1) img = img.resize({ width: Math.round(width * f), quality: "best" });
        return { text: `Bild ${path.basename(p)} (${width}×${height})`, image: img.toJPEG(85).toString("base64"), imageType: "image/jpeg" };
      }
      if (TEXT.test(p)) {
        const buf = fs.readFileSync(p).subarray(0, 150_000);
        return { text: `<dokument_inhalt datei="${path.basename(p)}">\n${buf.toString("utf8")}\n</dokument_inhalt>${st.size > 150_000 ? "\n(gekürzt)" : ""}` };
      }
      return { text: `${path.basename(p)} (${kb(st.size)}) ist kein lesbares Format (z. B. DWG). Im Programm öffnen und als PDF exportieren, dann pc_datei_ansehen.` };
    }
    case "pc_datei_hochladen": {
      const p = safePath(i.pfad);
      const st = fs.statSync(p);
      if (!st.isFile()) throw new Error("Keine Datei.");
      if (st.size > 15 * 1024 * 1024) throw new Error("Datei größer als 15 MB.");
      const text = await ctx.upload(p, i.projektId);
      return { text };
    }
    default:
      throw new Error(`Werkzeug ${name} gibt es in der Windows-App nicht.`);
  }
}

module.exports = { computer, pcTool, screenshot, preview, PASSIVE, forbiddenText, apiScale };
