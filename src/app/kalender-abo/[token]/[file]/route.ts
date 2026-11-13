import { buildIcs, icsTokenOk } from "@/lib/ics";
import { readLicense } from "@/lib/license";

// Öffentlich (im matcher von proxy.ts ausgenommen) – geschützt nur durch den geheimen Link
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!icsTokenOk(token)) return new Response("Nicht gefunden", { status: 404 });
  if (!(await readLicense()).ok) return new Response("Jarvis ist nicht freigeschaltet", { status: 403 });
  return new Response(await buildIcs(), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
