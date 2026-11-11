import { buildIcs, icsTokenOk } from "@/lib/ics";

// Öffentlich (im matcher von proxy.ts ausgenommen) – geschützt nur durch den geheimen Link
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!icsTokenOk(token)) return new Response("Nicht gefunden", { status: 404 });
  return new Response(await buildIcs(), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
