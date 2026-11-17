// Beim Start: Einstellungen aus der Datenbank laden (Schlüssel aus der Oberfläche), dann die Hintergrund-Jobs
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Ein einzelner Fehler (z. B. abgebrochene Postfach-Verbindung) darf nie den ganzen Server beenden
  const g = globalThis as { __pmGuard?: boolean };
  if (!g.__pmGuard) {
    g.__pmGuard = true;
    process.on("uncaughtException", (e) => console.error("[Jarvis] Unerwarteter Fehler (Server läuft weiter):", e));
    process.on("unhandledRejection", (e) => console.error("[Jarvis] Unbehandelter Fehler (Server läuft weiter):", e));
  }
  const { loadSettings } = await import("@/lib/settings");
  await loadSettings();
  if (process.env.NODE_ENV !== "production" && process.env.JOBS !== "1") return;
  const { startJobs } = await import("@/lib/jobs");
  startJobs();
}
