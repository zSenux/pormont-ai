import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { docData } from "@/lib/buchhaltung/docs";
import { renderDocPdf } from "@/lib/buchhaltung/pdf";

export const dynamic = "force-dynamic";

/** Probe-PDF mit dem eigenen Briefpapier: letzter Beleg als Vorschau mit Wasserzeichen (nur Admin, ändert nichts) */
export async function GET() {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (me.role !== "ADMIN") return new Response("Keine Berechtigung.", { status: 403 });
  const d = await db.salesDoc.findFirst({ where: { kind: { in: ["RECHNUNG", "ANGEBOT"] } }, orderBy: { updatedAt: "desc" }, include: { customer: true, project: { select: { name: true } } } });
  if (!d) return new Response("Noch kein Angebot und keine Rechnung da – lege zuerst einen Entwurf an.", { status: 404 });
  const data = await docData(d);
  const body = await renderDocPdf({ ...data, number: null }, null);
  return new Response(Buffer.from(body), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Briefpapier_Probe.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
