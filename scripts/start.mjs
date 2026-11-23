// Start in Produktion (pnpm start): Datenbank-Schema angleichen, dann Next.js unter Aufsicht starten.
//
// Der Wächter sorgt dafür, dass Jarvis nach einem Absturz von selbst wieder hochkommt:
//  - Beendet sich die App (Fehler, Speicher voll), startet er sie nach kurzer Pause neu.
//  - Antwortet /api/health mehrmals hintereinander nicht mit „ok“ (z. B. weil der Server hängt),
//    wird die App beendet und neu gestartet.
// Ohne Abhängigkeiten, läuft mit dem Node aus dem Container.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PORT = process.env.PORT || "3000";
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const CHECK_EVERY_MS = 30_000;
const CHECK_TIMEOUT_MS = 15_000;
const FAILS_BEFORE_RESTART = 4; // 4 × 30 s = 2 Minuten ohne Antwort
const START_GRACE_MS = 120_000; // Zeit zum Hochfahren, bevor geprüft wird

const log = (...a) => console.log(new Date().toISOString(), "[Wächter]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Schema angleichen (wie bisher `prisma db push`). Kurze Wiederholungen, falls die Datenbank noch startet.
//    Scheitert es dauerhaft (z. B. Änderung mit Datenverlust), bricht der Start ab – wie bisher.
if (process.env.SKIP_DB_PUSH !== "1") {
  const prisma = require.resolve("prisma/build/index.js");
  let ok = false;
  for (let i = 1; i <= 5 && !ok; i++) {
    const r = spawnSync(process.execPath, [prisma, "db", "push"], { stdio: "inherit", env: process.env });
    ok = r.status === 0;
    if (!ok && i < 5) {
      log(`prisma db push fehlgeschlagen (Versuch ${i}/5) – neuer Versuch in 10 s`);
      await sleep(10_000);
    }
  }
  if (!ok) {
    log("prisma db push fehlgeschlagen – Start abgebrochen");
    process.exit(1);
  }
}

// 2. Next.js starten und überwachen
const nextBin = require.resolve("next/dist/bin/next");
let child = null;
let stopping = false;
let restarts = []; // Zeitpunkte der letzten Neustarts (gegen Neustart-Schleifen)
let fails = 0;
let startedAt = 0;

function startApp() {
  startedAt = Date.now();
  fails = 0;
  child = spawn(process.execPath, [nextBin, "start"], {
    stdio: "inherit",
    env: { ...process.env, PM_SUPERVISED: "1" },
  });
  log(`App gestartet (PID ${child.pid})`);
  child.on("exit", async (code, signal) => {
    child = null;
    if (stopping) process.exit(code ?? 0);
    log(`App beendet (Code ${code ?? "-"}, Signal ${signal ?? "-"}) – Neustart`);
    const now = Date.now();
    restarts = restarts.filter((t) => now - t < 10 * 60_000);
    restarts.push(now);
    // Mehr als 5 Abstürze in 10 Minuten: länger warten, damit der Server nicht im Kreis startet
    await sleep(restarts.length > 5 ? 60_000 : 3_000);
    if (!stopping) startApp();
  });
}

async function checkHealth() {
  if (!child || Date.now() - startedAt < START_GRACE_MS) return;
  let ok = false;
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: "no-store" });
    ok = res.ok;
    if (!ok) log(`Lebenszeichen: Status ${res.status}`);
  } catch (e) {
    log(`Lebenszeichen ohne Antwort: ${e?.message ?? e}`);
  }
  if (ok) {
    fails = 0;
    return;
  }
  fails++;
  if (fails >= FAILS_BEFORE_RESTART && child) {
    log(`${fails} Prüfungen hintereinander ohne „ok“ – App hängt, wird neu gestartet`);
    fails = 0;
    const c = child;
    c.kill("SIGTERM");
    // Reagiert sie nicht, hart beenden
    setTimeout(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    }, 15_000).unref();
  }
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    if (!child) process.exit(0);
    child.kill(sig);
    setTimeout(() => process.exit(0), 20_000).unref();
  });
}

startApp();
setInterval(checkHealth, CHECK_EVERY_MS);
