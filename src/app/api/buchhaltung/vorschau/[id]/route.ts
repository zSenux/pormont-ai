import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { BookError, draftInput, previewDraftPdf } from "@/lib/buchhaltung/docs";

export const dynamic = "force-dynamic";

/**
 * Live-Vorschau im Beleg-Editor: nimmt die ungespeicherten Eingaben und liefert das PDF so,
 * wie es mit Briefpapier und Fußzeile aussieht. Speichert nichts (deshalb auch ohne Freischaltung erlaubt).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canArea(me, "buchhaltung")) return Response.json({ error: "Keine Berechtigung." }, { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return Response.json({ error: "Ungültig." }, { status: 400 });
  const raw = await req.json().catch(() => null);
  const input = draftInput.safeParse(raw ?? {});
  if (!input.success) return Response.json({ error: input.error.issues[0]?.message ?? "Eingaben ungültig." }, { status: 400 });
  try {
    const pdf = await previewDraftPdf(id, input.data);
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof BookError) return Response.json({ error: e.message }, { status: 409 });
    console.error("Belegvorschau", e);
    return Response.json({ error: "Vorschau konnte nicht erstellt werden." }, { status: 500 });
  }
}
