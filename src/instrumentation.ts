// Beim Start: Einstellungen aus der Datenbank laden (Schlüssel aus der Oberfläche), dann die Hintergrund-Jobs
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSettings } = await import("@/lib/settings");
  await loadSettings();
  if (process.env.NODE_ENV !== "production" && process.env.JOBS !== "1") return;
  const { startJobs } = await import("@/lib/jobs");
  startJobs();
}
