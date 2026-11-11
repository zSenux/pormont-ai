// Lebenszeichen für Hosting/Überwachung (ohne Anmeldung, ohne Daten)
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, app: "promont-jarvis" });
}
