import { currentUser, lockedResponse } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { datevFile } from "@/lib/buchhaltung/datev";

export const dynamic = "force-dynamic";

/** DATEV-Buchungsstapel (EXTF) für den Steuerberater – nur Admin. Markiert die Ausgaben als exportiert. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Nicht angemeldet.", { status: 401 });
  if (u.role !== "ADMIN") return new Response("Nur für Administratoren.", { status: 403 });
  const locked = await lockedResponse();
  if (locked) return locked;
  const sp = new URL(req.url).searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const von = sp.get("von") ?? "";
  const bis = sp.get("bis") ?? "";
  if (!ymd.test(von) || !ymd.test(bis) || von > bis) return new Response("Zeitraum prüfen (von/bis als JJJJ-MM-TT).", { status: 400 });
  try {
    const f = await datevFile(von, bis);
    if (f.purchaseIds.length) await db.purchaseDoc.updateMany({ where: { id: { in: f.purchaseIds }, exportedAt: null }, data: { exportedAt: new Date() } });
    return new Response(new Uint8Array(f.body), { headers: { "Content-Type": "text/csv; charset=windows-1252", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Export fehlgeschlagen.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
