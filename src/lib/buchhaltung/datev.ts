import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts } from "@/lib/berlin";
import { bookConfig, type BookConfig } from "./config";
import { computeTotals, readLines } from "./money";
import { customerName, readParty } from "./docs";
import type { PurchaseCategory } from "./purchases";

// DATEV-Export (Format „EXTF“ Buchungsstapel, Version 700) für den Steuerberater.
// Doppelte Buchführung: Rechnung = Debitor an Erlöse, Zahlung = Bank an Debitor,
// Ausgabe = Aufwand an Kreditor (Sammelkreditor 70000), Bezahlung = Kreditor an Bank/Kasse.
// Kontenzuordnung nach SKR 03/04 – der Steuerberater kann sie beim Import anpassen.

type Skr = BookConfig["datevSkr"];
const ACC = {
  "03": { revenue: { 19: 8400, 7: 8300, 0: 8200 }, rc13b: 8337, bank: 1200, cash: 1000, creditor: 70000, debitor: 10000 },
  "04": { revenue: { 19: 4400, 7: 4300, 0: 4200 }, rc13b: 4337, bank: 1800, cash: 1600, creditor: 70000, debitor: 10000 },
} as const;

/** Aufwandskonten je Kategorie. auto = Automatikkonto mit Vorsteuer (kein BU-Schlüssel nötig) */
const EXPENSE: Record<PurchaseCategory, Record<Skr, { 19: number; 7: number; 0: number; auto?: boolean }>> = {
  MATERIAL: { "03": { 19: 3400, 7: 3300, 0: 3200, auto: true }, "04": { 19: 5400, 7: 5300, 0: 5200, auto: true } },
  FREMDLEISTUNG: { "03": { 19: 3100, 7: 3100, 0: 3100 }, "04": { 19: 5900, 7: 5900, 0: 5900 } },
  WERKZEUG: { "03": { 19: 4985, 7: 4985, 0: 4985 }, "04": { 19: 6845, 7: 6845, 0: 6845 } },
  FAHRZEUG: { "03": { 19: 4540, 7: 4540, 0: 4540 }, "04": { 19: 6540, 7: 6540, 0: 6540 } },
  TANKEN: { "03": { 19: 4530, 7: 4530, 0: 4530 }, "04": { 19: 6530, 7: 6530, 0: 6530 } },
  BUERO: { "03": { 19: 4930, 7: 4930, 0: 4930 }, "04": { 19: 6815, 7: 6815, 0: 6815 } },
  BEWIRTUNG: { "03": { 19: 4650, 7: 4650, 0: 4650 }, "04": { 19: 6640, 7: 6640, 0: 6640 } },
  MIETE: { "03": { 19: 4960, 7: 4960, 0: 4960 }, "04": { 19: 6835, 7: 6835, 0: 6835 } },
  VERSICHERUNG: { "03": { 19: 4360, 7: 4360, 0: 4360 }, "04": { 19: 6400, 7: 6400, 0: 6400 } },
  SONSTIGES: { "03": { 19: 4900, 7: 4900, 0: 4900 }, "04": { 19: 6300, 7: 6300, 0: 6300 } },
};
/** BU-Schlüssel Vorsteuer (DATEV-Standard): 9 = 19 %, 8 = 7 % */
const VST_KEY = { 19: "9", 7: "8", 0: "" } as const;

export type DatevRow = { amount: number; sh: "S" | "H"; konto: number; gegen: number; bu: string; date: Date; beleg: string; text: string };

const rate = (r: number) => (r === 7 ? 7 : r === 0 ? 0 : 19) as 19 | 7 | 0;
const beleg = (s: string) => s.replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36);

export async function datevRows(from: string, to: string, cfg: BookConfig) {
  const skr = cfg.datevSkr;
  const a = ACC[skr];
  const range = { gte: berlinDateTime(from), lte: berlinDateTime(to, "23:59") };
  const [docs, payments, purchases, paidPurchases] = await Promise.all([
    db.salesDoc.findMany({ where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: range }, orderBy: [{ date: "asc" }, { number: "asc" }], include: { customer: { select: { name: true, number: true } } } }),
    db.payment.findMany({ where: { day: range }, orderBy: { day: "asc" }, include: { doc: { select: { number: true, address: true, customer: { select: { name: true, number: true } } } } } }),
    db.purchaseDoc.findMany({ where: { date: range }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    db.purchaseDoc.findMany({ where: { status: "BEZAHLT", paidAt: range }, orderBy: { paidAt: "asc" } }),
  ]);
  const rows: DatevRow[] = [];
  const debitor = (c: { number: number | null } | null | undefined, address: unknown) => c?.number ?? readParty(address).customerNo ?? a.debitor;

  for (const d of docs) {
    const t = computeTotals(readLines(d.lines), d.reverseCharge);
    const sh = d.kind === "GUTSCHRIFT" ? "H" : "S";
    // Schlussrechnung: nur der Rest nach Abzug der Abschläge (die sind schon als eigene Rechnungen gebucht), anteilig je Steuersatz
    const factor = d.grossCents > 0 && d.prepaidCents ? (d.grossCents - d.prepaidCents) / d.grossCents : 1;
    for (const g of t.taxes) {
      const amount = Math.round((g.netCents + g.taxCents) * factor) / 100;
      if (!amount) continue;
      rows.push({ amount, sh, konto: debitor(d.customer, d.address), gegen: d.reverseCharge ? a.rc13b : a.revenue[rate(g.rate)], bu: "", date: d.date, beleg: beleg(d.number ?? ""), text: `${customerName(d)}`.slice(0, 60) });
    }
  }
  for (const p of payments) {
    rows.push({ amount: Math.abs(p.amountCents) / 100, sh: p.amountCents >= 0 ? "S" : "H", konto: a.bank, gegen: debitor(p.doc.customer, p.doc.address), bu: "", date: p.day, beleg: beleg(p.doc.number ?? ""), text: `Zahlung ${p.doc.customer?.name ?? readParty(p.doc.address).name}`.slice(0, 60) });
  }
  for (const p of purchases) {
    const acc = EXPENSE[(p.category as PurchaseCategory) in EXPENSE ? (p.category as PurchaseCategory) : "SONSTIGES"][skr];
    const r = rate(p.taxRate);
    rows.push({ amount: Math.abs(p.grossCents) / 100, sh: p.grossCents >= 0 ? "S" : "H", konto: acc[r], gegen: a.creditor, bu: acc.auto && r !== 0 ? "" : VST_KEY[r], date: p.date, beleg: beleg(p.number), text: `${p.supplier}${p.docNo ? ` ${p.docNo}` : ""}`.slice(0, 60) });
  }
  for (const p of paidPurchases) {
    rows.push({ amount: Math.abs(p.grossCents) / 100, sh: p.grossCents >= 0 ? "S" : "H", konto: a.creditor, gegen: p.payMethod === "BAR" ? a.cash : a.bank, bu: "", date: p.paidAt!, beleg: beleg(p.number), text: `Zahlung ${p.supplier}`.slice(0, 60) });
  }
  rows.sort((x, y) => x.date.getTime() - y.date.getTime());
  return { rows, purchaseIds: purchases.map((p) => p.id) };
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const num = (n: number) => n.toFixed(2).replace(".", ",");
const ddmm = (d: Date) => {
  const p = berlinParts(d).ymd;
  return `${p.slice(8, 10)}${p.slice(5, 7)}`;
};
/** DATEV erwartet Windows-1252: Zeichen außerhalb von Latin-1 werden ersetzt */
function cp1252(s: string) {
  const out = s.replace(/€/g, "EUR").replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, "-").replace(/[^\x00-\xff]/g, "?");
  return Buffer.from(out, "latin1");
}

export async function datevFile(from: string, to: string) {
  const cfg = await bookConfig();
  if (!cfg.datevBerater || !cfg.datevMandant) throw new Error("Bitte zuerst Berater- und Mandantennummer unter Buchhaltung → Einstellungen eintragen (vom Steuerberater).");
  if (from.slice(0, 4) !== to.slice(0, 4)) throw new Error("Ein DATEV-Stapel darf nur ein Kalenderjahr enthalten – bitte Zeitraum innerhalb eines Jahres wählen.");
  const { rows, purchaseIds } = await datevRows(from, to, cfg);
  const year = Number(from.slice(0, 4));
  const wj = `${cfg.datevWjMonth > Number(from.slice(5, 7)) ? year - 1 : year}${String(cfg.datevWjMonth).padStart(2, "0")}01`;
  const now = berlinParts(new Date());
  const stamp = `${now.ymd.replace(/-/g, "")}${String(now.h).padStart(2, "0")}${String(now.min).padStart(2, "0")}00000`;
  const header = ["EXTF", 700, 21, "Buchungsstapel", 13, stamp, "", "RE", "Jarvis", "", cfg.datevBerater, cfg.datevMandant, wj, 4, from.replace(/-/g, ""), to.replace(/-/g, ""), `Jarvis ${from} bis ${to}`, "", 1, 0, 0, "EUR", "", "", "", "", cfg.datevSkr, "", "", "", ""]
    .map((v) => (typeof v === "string" && v !== "" && !/^\d+$/.test(v) ? q(v) : String(v)))
    .join(";");
  const cols = ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext"].join(";");
  const lines = rows.map((r) => [num(r.amount), q(r.sh), q("EUR"), "", "", "", r.konto, r.gegen, r.bu ? q(r.bu) : "", ddmm(r.date), q(r.beleg), "", "", q(r.text)].join(";"));
  const body = cp1252([header, cols, ...lines].join("\r\n") + "\r\n");
  return { body, count: rows.length, purchaseIds, name: `EXTF_Buchungsstapel_${from}_${to}.csv` };
}
