import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { csvResponse, deNum } from "@/lib/csv";
import { loadList, readParams } from "@/lib/buchhaltung/belegliste";

export const dynamic = "force-dynamic";

/** Belegliste wie angezeigt (gleiche Filter) als CSV für Excel – nur lesen */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "buchhaltung")) return new Response("Keine Berechtigung.", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const p = readParams(sp);
  const { rows } = await loadList(p);
  const day = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  return csvResponse(
    `Belegliste_${p.art}_${p.jahr}.csv`,
    ["Datum", "Art", "Belegnr.", "Notiz", "Status", "Kd-Nr.", "Kunde", "Gesamt", "Abschlag", "Forderung", "Offen", "Quelle"],
    rows.map((r) => [day(r.date), r.art, r.number ?? "Entwurf", r.note, r.statusText, r.customerNo ?? "", r.customer, deNum(r.gross / 100), deNum(r.prepaid / 100), deNum(r.claim / 100), deNum(r.open / 100), r.imported ? "Lexware" : "Jarvis"]),
  );
}
