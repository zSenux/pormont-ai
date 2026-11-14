import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { mailAttachment, MailError } from "@/lib/mail/client";

// Anhang immer als Download (nie im Browser ausführen)
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string; n: string }> }) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canArea(me, "mail")) return new Response("Keine Berechtigung.", { status: 403 });
  const { uid, n } = await params;
  const u = Number(uid), i = Number(n);
  if (!Number.isInteger(u) || u <= 0 || !Number.isInteger(i) || i < 0 || i > 100) return Response.json({ error: "Ungültig." }, { status: 400 });
  try {
    const a = await mailAttachment(u, i);
    const name = a.filename.replace(/[\r\n"\\]/g, "_");
    return new Response(new Uint8Array(a.content), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof MailError ? e.message : "Fehler." }, { status: e instanceof MailError ? 404 : 500 });
  }
}
