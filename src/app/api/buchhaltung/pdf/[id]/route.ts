import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { docData } from "@/lib/buchhaltung/docs";
import { renderDocPdf } from "@/lib/buchhaltung/pdf";
import { docLabel } from "@/lib/buchhaltung/types";

export const dynamic = "force-dynamic";

const fileName = (s: string) => s.replace(/[^\w.\-]/g, "_");

/** PDF eines Belegs: festgeschrieben = archiviertes Original (unverändert), Entwurf = Vorschau mit Wasserzeichen */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Nicht angemeldet.", { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Ungültig.", { status: 400 });
  const d = await db.salesDoc.findUnique({ where: { id }, include: { customer: true, project: { select: { name: true } } } });
  if (!d) return new Response("Nicht gefunden.", { status: 404 });
  let body: Uint8Array;
  if (d.status !== "ENTWURF") {
    if (!d.pdf) return new Response("Zu diesem Beleg gibt es kein PDF (Original aus Lexware nicht übernommen).", { status: 404 });
    body = new Uint8Array(d.pdf);
  } else body = await renderDocPdf(await docData(d), null);
  const name = fileName(`${docLabel(d)}_${d.number ?? "Entwurf"}.pdf`);
  const download = new URL(req.url).searchParams.has("download");
  return new Response(Buffer.from(body), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
