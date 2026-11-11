// Startet die Hintergrund-Jobs einmal je Server-Prozess
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" && process.env.JOBS !== "1") return;
  const { startJobs } = await import("@/lib/jobs");
  startJobs();
}
