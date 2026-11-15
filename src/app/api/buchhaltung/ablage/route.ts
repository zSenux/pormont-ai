import { currentUser } from "@/lib/auth/user";
import { canArea } from "@/lib/rights-shared";
import { ablageZip, isMonth } from "@/lib/buchhaltung/ablage";

export const dynamic = "force-dynamic";

/** Monatsablage als ZIP (Ausgangsrechnungen mit E-Rechnung, Eingangsbelege, Kontoauszüge, Inhalt.csv) – nur lesen */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "buchhaltung")) return new Response("Keine Berechtigung.", { status: 403 });
  const month = new URL(req.url).searchParams.get("monat");
  if (!isMonth(month)) return new Response("Monat fehlt (JJJJ-MM).", { status: 400 });
  const { data } = await ablageZip(month);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="ProMont_Ablage_${month}.zip"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
