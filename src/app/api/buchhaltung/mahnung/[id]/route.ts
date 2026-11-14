import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { DUNNING_LABEL } from "@/lib/buchhaltung/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "buchhaltung")) return new Response("Keine Berechtigung.", { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Ungültig.", { status: 400 });
  const dn = await db.dunning.findUnique({ where: { id }, include: { doc: { select: { number: true } } } });
  if (!dn) return new Response("Nicht gefunden.", { status: 404 });
  const name = `${DUNNING_LABEL[dn.level]}_${dn.doc.number}.pdf`.replace(/[^\w.\-]/g, "_");
  return new Response(Buffer.from(dn.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
