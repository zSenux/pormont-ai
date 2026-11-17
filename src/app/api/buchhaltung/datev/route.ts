import { currentUser, lockedResponse } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { bookConfig } from "@/lib/buchhaltung/config";
import { checkDatev, datevFile, datevStammdaten } from "@/lib/buchhaltung/datev";
import { datevPaket } from "@/lib/buchhaltung/datev-paket";

export const dynamic = "force-dynamic";

/**
 * DATEV-Export für den Steuerberater – nur Admin.
 * art=paket (ZIP: Buchungsstapel + Debitoren + Belegbilder), art=stammdaten (Debitoren/Kreditoren), sonst nur der Buchungsstapel.
 * altbelege=1 nimmt aus Lexware übernommene Rechnungen mit. Stapel/Paket markieren die Ausgaben als exportiert.
 */
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
  const art = sp.get("art");
  const opt = { withImported: sp.get("altbelege") === "1" };
  const head = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  const mark = async (ids: string[]) => {
    if (ids.length) await db.purchaseDoc.updateMany({ where: { id: { in: ids }, exportedAt: null }, data: { exportedAt: new Date() } });
  };
  try {
    if (art === "stammdaten") {
      const cfg = await bookConfig();
      checkDatev(cfg, von, bis);
      const f = await datevStammdaten(cfg, von, bis);
      return new Response(new Uint8Array(f.body), { headers: head("text/csv; charset=windows-1252", f.name) });
    }
    if (art === "paket") {
      const p = await datevPaket(von, bis, opt);
      await mark(p.purchaseIds);
      return new Response(new Uint8Array(p.data), { headers: head("application/zip", p.name) });
    }
    const f = await datevFile(von, bis, opt);
    await mark(f.purchaseIds);
    return new Response(new Uint8Array(f.body), { headers: head("text/csv; charset=windows-1252", f.name) });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Export fehlgeschlagen.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
