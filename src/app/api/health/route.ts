// Lebenszeichen für Hosting/Überwachung (ohne Anmeldung, ohne Kundendaten).
// Prüft auch die Datenbank (max. 5 s): hängt der Verbindungs-Pool, antwortet die Route mit 503,
// und der Wächter in scripts/start.mjs startet die App neu.
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), 5_000);
      }),
    ]);
    dbOk = true;
  } catch (e) {
    // Details nur ins Server-Log – die Route ist öffentlich
    console.warn("[health] Datenbank-Prüfung fehlgeschlagen:", e);
    dbError = e instanceof Error && e.message === "Zeitüberschreitung" ? "Zeitüberschreitung" : "nicht erreichbar";
  } finally {
    clearTimeout(timer);
  }
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  return Response.json(
    {
      ok: dbOk,
      app: "promont-jarvis",
      db: dbOk ? "ok" : dbError,
      dbMs: Date.now() - started,
      uptimeMin: Math.round(process.uptime() / 60),
      memoryMb: { rss: mb(mem.rss), heap: mb(mem.heapUsed) },
    },
    { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
