// Windows-Helfer über PowerShell + user32 (keine nativen Module → der Installer baut ohne Compiler).
// Werte gehen NIE in den Skripttext, sondern als Umgebungsvariablen (JV_*) – keine Einschleusung über Text/Pfade.
// Übernommen aus Klaic OS (windows-app/src/win.js) und um Maus-/Fenster-Funktionen für die Computer-Steuerung erweitert.

const NATIVE = `
Add-Type -Language CSharp @"
using System; using System.Runtime.InteropServices; using System.Text;
public class KW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern short VkKeyScanW(char c);
  public struct POINT { public int X; public int Y; }
}
"@
[void][KW]::SetProcessDPIAware()
`;

// Dauerhafte PowerShell (spart je Aufruf ~1 s Start + C#-Übersetzung): je Zeile ein Auftrag als Base64-JSON { id, script, env }.
// Das Skript kommt nur von hier (feste Texte), Werte nur über $env:JV_* – beides wird im Host dekodiert, nicht zusammengesetzt.
const HOST_LOOP = `
${NATIVE}
$ErrorActionPreference = 'Continue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $job = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
  $names = @()
  try {
    foreach ($p in $job.env.PSObject.Properties) { [Environment]::SetEnvironmentVariable($p.Name, [string]$p.Value, 'Process'); $names += $p.Name }
    $out = (& ([ScriptBlock]::Create($job.script)) | Out-String).Trim()
    [Console]::Out.WriteLine("@@OK " + $job.id + " " + [Convert]::ToBase64String($utf8.GetBytes($out)))
  } catch {
    [Console]::Out.WriteLine("@@ERR " + $job.id + " " + [Convert]::ToBase64String($utf8.GetBytes($_.Exception.Message)))
  } finally {
    foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $null, 'Process') }
  }
}`;

class Host {
  constructor() {
    this.proc = null;
    this.buf = "";
    this.seq = 0;
    this.waiting = new Map();
    this.chain = Promise.resolve();
  }
  start() {
    const { spawn } = require("node:child_process");
    const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(HOST_LOOP, "utf16le").toString("base64")], { windowsHide: true });
    this.proc = proc;
    this.buf = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d) => {
      if (this.proc !== proc) return;
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        const m = /^@@(OK|ERR) (\d+) ?(.*)$/.exec(line);
        const w = m && this.waiting.get(m[2]);
        if (!w) continue;
        this.waiting.delete(m[2]);
        const text = Buffer.from(m[3] || "", "base64").toString("utf8");
        m[1] === "OK" ? w.resolve(text) : w.reject(new Error(text.slice(0, 500)));
      }
    });
    // nur Aufträge DIESES Prozesses abbrechen (nach einer Zeitüberschreitung läuft schon ein neuer)
    const fail = () => {
      if (this.proc !== proc) return;
      for (const w of this.waiting.values()) w.reject(new Error("PowerShell beendet."));
      this.waiting.clear();
      this.proc = null;
    };
    proc.on("exit", fail);
    proc.on("error", fail);
  }
  run(script, env, timeout) {
    // nacheinander – ein Host arbeitet immer nur einen Auftrag ab
    const p = this.chain.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.proc) this.start();
          const id = String(++this.seq);
          const t = setTimeout(() => {
            this.waiting.delete(id);
            const dead = this.proc;
            this.proc = null; // nächster Auftrag startet einen frischen Host
            dead?.kill();
            reject(new Error("Zeitüberschreitung."));
          }, timeout);
          this.waiting.set(id, { resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) });
          this.proc.stdin.write(`${Buffer.from(JSON.stringify({ id, script, env }), "utf8").toString("base64")}\n`);
        }),
    );
    this.chain = p.catch(() => {});
    return p;
  }
}

const fast = new Host(); // Eingaben, Fenster, Kürzel
const slow = new Host(); // Gesundheit, Prozesslisten, Drucken (dürfen dauern, blockieren Tastenkürzel nicht)

/** PowerShell-Skript ausführen; env = { JV_…: Wert } */
function ps(script, env = {}, timeout = 20000, { background = false } = {}) {
  if (process.platform !== "win32") return Promise.reject(new Error("Nur unter Windows."));
  return (background ? slow : fast).run(script, env, timeout);
}

/** Einmal vorab starten, damit der erste Tastendruck nicht wartet */
function warmUp() {
  if (process.platform === "win32") fast.run("1", {}, 30000).catch(() => {});
}

/** Programm, Fenstertitel und Fenster-Handle des Fensters vorne */
async function foreground() {
  const out = await ps(`
$h=[KW]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [void][KW]::GetWindowText($h,$sb,512)
$p=0; [void][KW]::GetWindowThreadProcessId($h,[ref]$p)
$n=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
"$n" + [char]9 + $sb.ToString() + [char]9 + $h.ToInt64()`);
  const [app, title, hwnd] = out.split("\t");
  return { app: app || "", title: title || "", hwnd: /^\d+$/.test(hwnd || "") ? hwnd : "" };
}

/** Warten, bis Alt/Umschalt/Strg/Win losgelassen sind (Kürzel lösen aus, während sie noch gedrückt sind), max. 1,5 s */
function waitModsReleased() {
  return ps("$t=0; while($t -lt 30 -and ((([KW]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0) -or (([KW]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0) -or (([KW]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0) -or (([KW]::GetAsyncKeyState(0x5B) -band 0x8000) -ne 0))){ Start-Sleep -Milliseconds 50; $t++ }");
}

/** Fenster per Handle wieder nach vorne holen (Ziel für „Einfügen“) */
function focusWindow(hwnd) {
  if (!/^\d{1,20}$/.test(String(hwnd))) return Promise.resolve();
  return ps("[void][KW]::SetForegroundWindow([IntPtr][int64]$env:JV_H)", { JV_H: String(hwnd) });
}

function click(x, y, { double = false, right = false } = {}) {
  return ps(
    `
$x=[int]$env:JV_X; $y=[int]$env:JV_Y; $n=[int]$env:JV_N; $r=$env:JV_R -eq "1"
[void][KW]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 60
for($i=0;$i -lt $n;$i++){
  if($r){ [KW]::mouse_event(0x08,0,0,0,[UIntPtr]::Zero); [KW]::mouse_event(0x10,0,0,0,[UIntPtr]::Zero) }
  else { [KW]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); [KW]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 70
}`,
    { JV_X: String(Math.round(x)), JV_Y: String(Math.round(y)), JV_N: double ? "2" : "1", JV_R: right ? "1" : "0" },
  );
}

function scroll(x, y, clicks) {
  return ps(
    `[void][KW]::SetCursorPos([int]$env:JV_X,[int]$env:JV_Y); Start-Sleep -Milliseconds 60; [KW]::mouse_event(0x0800,0,0,[int]$env:JV_D,[UIntPtr]::Zero)`,
    { JV_X: String(Math.round(x)), JV_Y: String(Math.round(y)), JV_D: String(Math.round(clicks * 120)) },
  );
}

const MODS = { strg: 0x11, ctrl: 0x11, control: 0x11, control_l: 0x11, control_r: 0x11, alt: 0x12, alt_l: 0x12, alt_r: 0x12, shift: 0x10, shift_l: 0x10, shift_r: 0x10, umschalt: 0x10, win: 0x5b, windows: 0x5b, super: 0x5b, super_l: 0x5b, meta: 0x5b, cmd: 0x5b };
// erweiterte Tasten (Pfeile, Pos1 …) brauchen das Flag KEYEVENTF_EXTENDEDKEY
const KEYS = {
  enter: [0x0d], eingabe: [0x0d], return: [0x0d], tab: [0x09], esc: [0x1b], escape: [0x1b], leertaste: [0x20], space: [0x20], leer: [0x20],
  backspace: [0x08], ruecktaste: [0x08], entf: [0x2e, 1], delete: [0x2e, 1], del: [0x2e, 1], einfg: [0x2d, 1], insert: [0x2d, 1],
  pfeil_hoch: [0x26, 1], hoch: [0x26, 1], up: [0x26, 1], pfeil_runter: [0x28, 1], runter: [0x28, 1], down: [0x28, 1],
  pfeil_links: [0x25, 1], links: [0x25, 1], left: [0x25, 1], pfeil_rechts: [0x27, 1], rechts: [0x27, 1], right: [0x27, 1],
  pos1: [0x24, 1], home: [0x24, 1], ende: [0x23, 1], end: [0x23, 1], bild_hoch: [0x21, 1], pageup: [0x21, 1], bild_runter: [0x22, 1], pagedown: [0x22, 1],
  lauter: [0xaf, 1], leiser: [0xae, 1], stumm: [0xad, 1],
  kp_enter: [0x0d], page_up: [0x21, 1], prior: [0x21, 1], page_down: [0x22, 1], next: [0x22, 1], menu: [0x5d, 1], apps: [0x5d, 1],
  print: [0x2c], druck: [0x2c], capslock: [0x14], caps_lock: [0x14], pause: [0x13],
  comma: [0xbc], komma: [0xbc], ",": [0xbc], period: [0xbe], punkt: [0xbe], ".": [0xbe], minus: [0xbd], "-": [0xbd], plus: [0xbb], "+": [0xbb],
};

/** „strg+shift+t“ → Liste virtueller Tasten [vk, extended] */
function parseCombo(combo) {
  // „ctrl++“ → Plus-Taste; xdotool-Namen sind groß/klein egal
  const raw = String(combo).toLowerCase().replace(/\s+/g, "").replace(/ä/g, "ae").replace(/ü/g, "ue");
  const parts = raw.endsWith("++") ? [...raw.slice(0, -2).split("+").filter(Boolean), "+"] : raw.split("+").filter(Boolean);
  if (!parts.length || parts.length > 4) throw new Error(`Unbekannte Taste „${combo}“.`);
  return parts.map((p) => {
    if (MODS[p]) return [MODS[p], 0];
    if (KEYS[p]) return [KEYS[p][0], KEYS[p][1] ? 1 : 0];
    const f = p.match(/^f([1-9]|1[0-2])$/);
    if (f) return [0x6f + Number(f[1]), 0];
    if (/^[a-z0-9]$/.test(p)) return [p.toUpperCase().charCodeAt(0), 0];
    throw new Error(`Unbekannte Taste „${p}“.`);
  });
}

/** Tasten gemeinsam drücken (in Reihenfolge runter, rückwärts hoch) */
function keys(list) {
  return ps(
    `
$vk=@(); $ex=@()
foreach($p in $env:JV_K.Split(",")){ $a=$p.Split(":"); $vk+=[byte][int]$a[0]; $ex+=[uint32][int]$a[1] }
for($i=0;$i -lt $vk.Count;$i++){ [KW]::keybd_event($vk[$i],0,$ex[$i],[UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
for($i=$vk.Count-1;$i -ge 0;$i--){ [KW]::keybd_event($vk[$i],0,($ex[$i] -bor 2),[UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }`,
    { JV_K: list.map(([vk, ext]) => `${vk}:${ext}`).join(",") },
  );
}

/** Eine Taste n-mal antippen (z. B. Lautstärke) */
function tap(vk, ext, n) {
  return ps(
    `for($i=0;$i -lt [int]$env:JV_N;$i++){ [KW]::keybd_event([byte][int]$env:JV_V,0,[uint32][int]$env:JV_E,[UIntPtr]::Zero); [KW]::keybd_event([byte][int]$env:JV_V,0,([uint32][int]$env:JV_E -bor 2),[UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }`,
    { JV_V: String(vk), JV_E: String(ext ? 1 : 0), JV_N: String(n) },
  );
}

function pressCombo(combo) {
  return keys(parseCombo(combo));
}


// ---------- Maus und Fenster für die Computer-Steuerung (Koordinaten = physische Pixel) ----------

const BTN = { left: [0x02, 0x04], right: [0x08, 0x10], middle: [0x20, 0x40] };
const int = (n) => String(Math.round(Number(n) || 0));

/** Klick mit linker/rechter/mittlerer Taste, n-fach; Zusatztasten (Liste [vk, ext]) werden dabei gehalten */
function clickN(x, y, button = "left", n = 1, mods = []) {
  const [down, up] = BTN[button] || BTN.left;
  return ps(
    `
$m=@(); if($env:JV_M){ foreach($p in $env:JV_M.Split(",")){ $m+=[byte][int]$p } }
foreach($k in $m){ [KW]::keybd_event($k,0,0,[UIntPtr]::Zero) }
[void][KW]::SetCursorPos([int]$env:JV_X,[int]$env:JV_Y); Start-Sleep -Milliseconds 60
for($i=0;$i -lt [int]$env:JV_N;$i++){ [KW]::mouse_event([uint32]$env:JV_D,0,0,0,[UIntPtr]::Zero); [KW]::mouse_event([uint32]$env:JV_U,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 70 }
for($i=$m.Count-1;$i -ge 0;$i--){ [KW]::keybd_event($m[$i],0,2,[UIntPtr]::Zero) }`,
    { JV_X: int(x), JV_Y: int(y), JV_N: String(Math.max(1, Math.min(3, n))), JV_D: String(down), JV_U: String(up), JV_M: mods.map(([vk]) => vk).join(",") },
  );
}

function moveTo(x, y) {
  return ps("[void][KW]::SetCursorPos([int]$env:JV_X,[int]$env:JV_Y)", { JV_X: int(x), JV_Y: int(y) });
}

/** Linke Maustaste drücken bzw. loslassen (an der aktuellen Position) */
function mouseButton(down) {
  return ps(`[KW]::mouse_event([uint32]$env:JV_F,0,0,0,[UIntPtr]::Zero)`, { JV_F: down ? "2" : "4" });
}

/** Ziehen von a nach b in kleinen Schritten (sonst erkennen manche Programme – auch CAD – kein Ziehen) */
function drag(ax, ay, bx, by) {
  return ps(
    `
$ax=[int]$env:JV_AX; $ay=[int]$env:JV_AY; $bx=[int]$env:JV_BX; $by=[int]$env:JV_BY
[void][KW]::SetCursorPos($ax,$ay); Start-Sleep -Milliseconds 80; [KW]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80
for($i=1;$i -le 20;$i++){ [void][KW]::SetCursorPos([int]($ax+($bx-$ax)*$i/20),[int]($ay+($by-$ay)*$i/20)); Start-Sleep -Milliseconds 15 }
Start-Sleep -Milliseconds 80; [KW]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero)`,
    { JV_AX: int(ax), JV_AY: int(ay), JV_BX: int(bx), JV_BY: int(by) },
  );
}

/** Rad: senkrecht (dy > 0 = nach unten) bzw. waagerecht */
function wheel(x, y, dy, dx) {
  return ps(
    `[void][KW]::SetCursorPos([int]$env:JV_X,[int]$env:JV_Y); Start-Sleep -Milliseconds 60
if([int]$env:JV_V -ne 0){ [KW]::mouse_event(0x0800,0,0,[int]$env:JV_V,[UIntPtr]::Zero) }
if([int]$env:JV_H -ne 0){ [KW]::mouse_event(0x01000,0,0,[int]$env:JV_H,[UIntPtr]::Zero) }`,
    { JV_X: int(x), JV_Y: int(y), JV_V: String(Math.round(-dy * 120)), JV_H: String(Math.round(dx * 120)) },
  );
}

async function cursorPos() {
  const out = await ps("$p=New-Object KW+POINT; [void][KW]::GetCursorPos([ref]$p); \"$($p.X) $($p.Y)\"");
  const [x, y] = out.trim().split(" ").map(Number);
  return { x: x || 0, y: y || 0 };
}

/** Tasten gedrückt halten (Sekunden) */
function holdKeys(list, seconds) {
  return ps(
    `
$vk=@(); $ex=@()
foreach($p in $env:JV_K.Split(",")){ $a=$p.Split(":"); $vk+=[byte][int]$a[0]; $ex+=[uint32][int]$a[1] }
for($i=0;$i -lt $vk.Count;$i++){ [KW]::keybd_event($vk[$i],0,$ex[$i],[UIntPtr]::Zero) }
Start-Sleep -Milliseconds ([int]$env:JV_MS)
for($i=$vk.Count-1;$i -ge 0;$i--){ [KW]::keybd_event($vk[$i],0,($ex[$i] -bor 2),[UIntPtr]::Zero) }`,
    { JV_K: list.map(([vk, ext]) => `${vk}:${ext}`).join(","), JV_MS: String(Math.round(Math.max(0.05, Math.min(10, seconds)) * 1000)) },
    20000,
  );
}

/** Offene Fenster: Programm + Titel */
async function windows() {
  const out = await ps("Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + [char]9 + $_.MainWindowTitle }", {}, 20000, { background: true });
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [app, title] = l.split("\t");
    return { app, title };
  });
}

/** Fenster nach vorne, dessen Titel oder Programmname den Text enthält */
async function front(text) {
  const out = await ps(
    `$t=$env:JV_T; $p=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*") } | Select-Object -First 1
if(!$p){ 'nicht gefunden' } else { if([KW]::IsIconic($p.MainWindowHandle)){ [void][KW]::ShowWindow($p.MainWindowHandle,9) }
# Alt kurz antippen, sonst verweigert Windows SetForegroundWindow aus dem Hintergrund
[KW]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [KW]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[void][KW]::SetForegroundWindow($p.MainWindowHandle); $p.ProcessName + [char]9 + $p.MainWindowTitle }`,
    { JV_T: String(text).replace(/[*?[\]`]/g, "").slice(0, 80) },
  );
  return out.trim();
}

/** Ist das Eingabefeld vorne ein Passwortfeld? (UI Automation) */
async function focusedIsPassword() {
  try {
    const out = await ps(
      `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$e = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($e) { [string]$e.Current.IsPassword } else { 'False' }`,
      {},
      5000,
    );
    return out.trim() === "True";
  } catch {
    return false;
  }
}

module.exports = { ps, warmUp, foreground, focusWindow, waitModsReleased, click, scroll, pressCombo, parseCombo, keys, clickN, moveTo, mouseButton, drag, wheel, cursorPos, holdKeys, windows, front, focusedIsPassword };
