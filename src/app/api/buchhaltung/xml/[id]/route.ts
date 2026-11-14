import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { docData } from "@/lib/buchhaltung/docs";
import { buildCii, xrechnungGaps } from "@/lib/buchhaltung/xrechnung";

export const dynamic = "force-dynamic";

/** E-Rechnung als XRechnung-XML (CII) – nur für festgeschriebene Rechnungen/Gutschriften aus Jarvis */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "buchhaltung")) return new Response("Keine Berechtigung.", { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Ungültig.", { status: 400 });
  const d = await db.salesDoc.findUnique({ where: { id } });
  if (!d || d.kind === "ANGEBOT" || d.status === "ENTWURF" || d.imported || !d.number) return new Response("Für diesen Beleg gibt es keine XRechnung.", { status: 404 });
  const data = await docData(d);
  const gaps = xrechnungGaps(data);
  if (gaps.length) return new Response(`Für die XRechnung fehlt: ${gaps.join(", ")}. Bitte beim Kunden ergänzen – die Rechnung selbst bleibt unverändert, die Angaben stammen aus dem Festschreiben.`, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(buildCii(data, "xrechnung"), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="XRechnung_${d.number.replace(/[^\w.\-]/g, "_")}.xml"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
