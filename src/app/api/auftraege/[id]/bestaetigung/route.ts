import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { confirmationPdf } from "@/lib/buchhaltung/auftragsbestaetigung";
import { BookError } from "@/lib/buchhaltung/docs";

export const dynamic = "force-dynamic";

/** Auftragsbestätigung als PDF (nur lesen – wird jedes Mal frisch aus Auftrag + Angebot erzeugt) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "auftraege")) return new Response("Keine Berechtigung.", { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Ungültig.", { status: 400 });
  try {
    const { pdf, filename } = await confirmationPdf(id);
    const download = new URL(req.url).searchParams.has("download");
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof BookError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
