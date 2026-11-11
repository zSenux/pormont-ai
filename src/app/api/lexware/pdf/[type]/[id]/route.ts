import { currentUser } from "@/lib/auth/user";
import { LexwareError } from "@/lib/lexware/client";
import { voucherPdf } from "@/lib/lexware/api";

export const dynamic = "force-dynamic";

const TYPES = new Set(["invoice", "quotation", "orderconfirmation", "creditnote"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDF eines Belegs direkt aus Lexware durchreichen (nur angemeldet) */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  if (!(await currentUser())) return new Response("Nicht angemeldet.", { status: 401 });
  const { type, id } = await params;
  if (!TYPES.has(type) || !UUID.test(id)) return new Response("Ungültig.", { status: 400 });
  try {
    const f = await voucherPdf(type, id);
    const name = /filename="?([^";]+)"?/i.exec(f.disposition ?? "")?.[1] ?? `${type}-${id}.pdf`;
    return new Response(f.body, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name.replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return new Response(e instanceof LexwareError ? e.message : "PDF konnte nicht geladen werden.", { status: e instanceof LexwareError && e.status ? e.status : 502 });
  }
}
