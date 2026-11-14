import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { csvResponse, deNum } from "@/lib/csv";
import { customerName, statusText } from "@/lib/buchhaltung/docs";
import { computeTotals, readLines } from "@/lib/buchhaltung/money";
import { docLabel } from "@/lib/buchhaltung/types";

export const dynamic = "force-dynamic";

/** Rechnungsausgangsbuch als CSV für den Steuerberater (Rechnungen + Gutschriften, festgeschrieben) */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Nicht angemeldet.", { status: 401 });
  if (u.role !== "ADMIN") return new Response("Nur für Administratoren.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const von = sp.get("von") ?? "";
  const bis = sp.get("bis") ?? "";
  if (!ymd.test(von) || !ymd.test(bis)) return new Response("Zeitraum fehlt (von/bis als JJJJ-MM-TT).", { status: 400 });
  const docs = await db.salesDoc.findMany({
    where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: { gte: berlinDateTime(von), lte: berlinDateTime(bis) } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    include: { customer: { select: { name: true, number: true } }, payments: { orderBy: { day: "desc" }, take: 1 } },
  });
  const rows = docs.map((d) => {
    const t = computeTotals(readLines(d.lines), d.reverseCharge);
    const tax = (r: number) => t.taxes.find((x) => x.rate === r);
    const sign = d.kind === "GUTSCHRIFT" ? -1 : 1;
    return [
      formatDate(d.date),
      d.number ?? "",
      docLabel(d),
      customerName(d),
      d.customer?.number ?? "",
      deNum((sign * d.netCents) / 100),
      deNum((sign * (tax(19)?.taxCents ?? 0)) / 100),
      deNum((sign * (tax(7)?.taxCents ?? 0)) / 100),
      d.reverseCharge ? "§ 13b" : "",
      deNum((sign * d.grossCents) / 100),
      d.prepaidCents ? deNum((sign * -d.prepaidCents) / 100) : "",
      deNum((sign * (d.grossCents - d.prepaidCents)) / 100),
      deNum((sign * d.paidCents) / 100),
      statusText(d),
      d.payments[0] ? formatDate(d.payments[0].day) : "",
      d.imported ? "Lexware" : "Jarvis",
    ];
  });
  return csvResponse(`Rechnungsausgang_${von}_${bis}.csv`, ["Datum", "Nummer", "Art", "Kunde", "Kd.-Nr.", "Netto", "USt 19 %", "USt 7 %", "Steuerhinweis", "Brutto", "Abzgl. Abschläge brutto", "Zu zahlen", "Bezahlt", "Status", "Letzte Zahlung", "Quelle"], rows);
}
