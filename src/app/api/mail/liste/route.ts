import { z } from "zod";
import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { listMails, MailError } from "@/lib/mail/client";
import { mailConfigured } from "@/lib/mail/config";
import { validKey } from "@/lib/mail/types";

// Weitere Mails für die Liste auf /mail nachladen (nur lesen)
const input = z.object({
  ordner: z.string().refine(validKey).optional(),
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["ungelesen"]).optional(),
  alle: z.literal("1").optional(),
  weiter: z.string().min(1).refine(validKey),
});

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canArea(me, "mail")) return Response.json({ error: "Keine Berechtigung." }, { status: 403 });
  if (!mailConfigured()) return Response.json({ error: "Postfach nicht verbunden." }, { status: 400 });
  const p = input.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const q = p.data.q && p.data.q.length >= 2 ? p.data.q : undefined;
  try {
    const r = await listMails({ folder: p.data.ordner || undefined, search: q, allFolders: Boolean(q && p.data.alle), unread: p.data.filter === "ungelesen", cursor: p.data.weiter, limit: 50 });
    return Response.json({ mails: r.mails, next: r.next }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof MailError ? e.message : "Postfach nicht erreichbar." }, { status: 502 });
  }
}
