import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { addDaysYmd, todayYmd } from "@/lib/berlin";
import { diaryPdf, DiaryError } from "@/lib/bautagebuch";
import { reportPdf } from "@/lib/bautagesbericht-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bautagesberichte als PDF (je Tag eine Seite im Aufbau des Kunden-Formulars) bzw. mit ?art=tagebuch das kompakte Bautagebuch:
 *  ?von=JJJJ-MM-TT&bis=JJJJ-MM-TT (Standard: letzte 30 Tage). Nur lesen – auch ohne Freischaltung. */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "projekte")) return new Response("Keine Berechtigung.", { status: 403 });
  const { projectId } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(projectId)) return new Response("Ungültig.", { status: 400 });
  const sp = new URL(req.url).searchParams;
  const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const to = ok(sp.get("bis")) ?? todayYmd();
  const from = ok(sp.get("von")) ?? addDaysYmd(to, -30);
  if (from > to) return new Response("„Von“ liegt nach „Bis“.", { status: 400 });
  try {
    const { bytes, name } = sp.get("art") === "tagebuch" ? await diaryPdf(projectId, from, to) : await reportPdf(projectId, from, to);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${sp.has("download") ? "attachment" : "inline"}; filename="${name.replace(/[^\w.\-]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof DiaryError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
