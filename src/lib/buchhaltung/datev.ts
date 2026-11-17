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

/** ref = woher die Buchung kommt (für die Belegbilder im DATEV-Paket) */
export type DatevRow = { amount: number; sh: "S" | "H"; konto: number; gegen: number; bu: string; date: Date; beleg: string; text: string; ref?: { sales?: string; purchase?: string } };
export type DatevOptions = { /** aus Lexware übernommene Altbelege samt deren übernommenen Zahlungen mitnehmen (Standard: nein – die hat der Steuerberater schon) */ withImported?: boolean };

/** Debitoren-Konto: Kundennummer, wenn sie im Personenkonten-Bereich 10000–69999 liegt, sonst Sammeldebitor */
export function debitorAccount(no: number | null | undefined, fallback: number) {
  return no && no >= 10000 && no <= 69999 ? no : fallback;
}
export const accountsFor = (skr: Skr) => ACC[skr];

const rate = (r: number) => (r === 7 ? 7 : r === 0 ? 0 : 19) as 19 | 7 | 0;
const beleg = (s: string) => s.replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36);

export async function datevRows(from: string, to: string, cfg: BookConfig, opt: DatevOptions = {}) {
  const skr = cfg.datevSkr;
  const a = ACC[skr];
  const range = { gte: berlinDateTime(from), lte: berlinDateTime(to, "23:59") };
  const [docs, payments, purchases, paidPurchases] = await Promise.all([
    db.salesDoc.findMany({ where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: range, ...(opt.withImported ? {} : { imported: false }) }, orderBy: [{ date: "asc" }, { number: "asc" }], include: { customer: { select: { name: true, number: true } } } }),
    db.payment.findMany({ where: { day: range, ...(opt.withImported ? {} : { OR: [{ note: null }, { NOT: { note: { contains: "Lexware" } } }] }) }, orderBy: { day: "asc" }, include: { doc: { select: { number: true, address: true, customer: { select: { name: true, number: true } } } } } }),
    db.purchaseDoc.findMany({ where: { date: range }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    db.purchaseDoc.findMany({ where: { status: "BEZAHLT", paidAt: range }, orderBy: { paidAt: "asc" } }),
  ]);
  const rows: DatevRow[] = [];
  const debitor = (c: { number: number | null } | null | undefined, address: unknown) => debitorAccount(c?.number ?? readParty(address).customerNo, a.debitor);

  for (const d of docs) {
    const t = computeTotals(readLines(d.lines), d.reverseCharge);
    const sh = d.kind === "GUTSCHRIFT" ? "H" : "S";
    // Schlussrechnung: nur der Rest nach Abzug der Abschläge (die sind schon als eigene Rechnungen gebucht), anteilig je Steuersatz
    const factor = d.grossCents > 0 && d.prepaidCents ? (d.grossCents - d.prepaidCents) / d.grossCents : 1;
    for (const g of t.taxes) {
      const amount = Math.round((g.netCents + g.taxCents) * factor) / 100;
      if (!amount) continue;
      rows.push({ amount, sh, konto: debitor(d.customer, d.address), gegen: d.reverseCharge ? a.rc13b : a.revenue[rate(g.rate)], bu: "", date: d.date, beleg: beleg(d.number ?? ""), text: `${customerName(d)}`.slice(0, 60), ref: { sales: d.id } });
    }
  }
  for (const p of payments) {
    rows.push({ amount: Math.abs(p.amountCents) / 100, sh: p.amountCents >= 0 ? "S" : "H", konto: a.bank, gegen: debitor(p.doc.customer, p.doc.address), bu: "", date: p.day, beleg: beleg(p.doc.number ?? ""), text: `Zahlung ${p.doc.customer?.name ?? readParty(p.doc.address).name}`.slice(0, 60) });
  }
  for (const p of purchases) {
    const acc = EXPENSE[(p.category as PurchaseCategory) in EXPENSE ? (p.category as PurchaseCategory) : "SONSTIGES"][skr];
    const r = rate(p.taxRate);
    rows.push({ amount: Math.abs(p.grossCents) / 100, sh: p.grossCents >= 0 ? "S" : "H", konto: acc[r], gegen: a.creditor, bu: acc.auto && r !== 0 ? "" : VST_KEY[r], date: p.date, beleg: beleg(p.number), text: `${p.supplier}${p.docNo ? ` ${p.docNo}` : ""}`.slice(0, 60), ref: { purchase: p.id } });
  }
  for (const p of paidPurchases) {
    rows.push({ amount: Math.abs(p.grossCents) / 100, sh: p.grossCents >= 0 ? "S" : "H", konto: a.creditor, gegen: p.payMethod === "BAR" ? a.cash : a.bank, bu: "", date: p.paidAt!, beleg: beleg(p.number), text: `Zahlung ${p.supplier}`.slice(0, 60) });
  }
  rows.sort((x, y) => x.date.getTime() - y.date.getTime());
  return { rows, purchaseIds: purchases.map((p) => p.id), skipped: opt.withImported ? 0 : await db.salesDoc.count({ where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: range, imported: true } }) };
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

/** Pflicht vor jedem Export: Berater-/Mandantennummer und ein Kalenderjahr */
export function checkDatev(cfg: BookConfig, from: string, to: string) {
  if (!cfg.datevBerater || !cfg.datevMandant) throw new Error("Bitte zuerst Berater- und Mandantennummer unter Buchhaltung → Einstellungen eintragen (vom Steuerberater).");
  if (from.slice(0, 4) !== to.slice(0, 4)) throw new Error("Ein DATEV-Stapel darf nur ein Kalenderjahr enthalten – bitte Zeitraum innerhalb eines Jahres wählen.");
}

/** Kopfzeile EXTF 700: Kategorie 21 = Buchungsstapel (Formatversion 13), 16 = Debitoren/Kreditoren (Formatversion 5) */
function extfHeader(cfg: BookConfig, kind: "stapel" | "stamm", from: string, to: string) {
  const year = Number(from.slice(0, 4));
  const wj = `${cfg.datevWjMonth > Number(from.slice(5, 7)) ? year - 1 : year}${String(cfg.datevWjMonth).padStart(2, "0")}01`;
  const now = berlinParts(new Date());
  const stamp = `${now.ymd.replace(/-/g, "")}${String(now.h).padStart(2, "0")}${String(now.min).padStart(2, "0")}00000`;
  const stapel = kind === "stapel";
  return [
    "EXTF", 700, stapel ? 21 : 16, stapel ? "Buchungsstapel" : "Debitoren/Kreditoren", stapel ? 13 : 5, stamp, "", "RE", "Jarvis", "", cfg.datevBerater, cfg.datevMandant, wj, 4,
    stapel ? from.replace(/-/g, "") : "", stapel ? to.replace(/-/g, "") : "", stapel ? `Jarvis ${from} bis ${to}` : "", "", stapel ? 1 : "", stapel ? 0 : "", stapel ? 0 : "", stapel ? "EUR" : "", "", "", "", "", `"${cfg.datevSkr}"`, "", "", "", "",
  ]
    .map((v) => (typeof v === "string" && v !== "" && !/^\d+$/.test(v) && !v.startsWith('"') ? q(v) : String(v)))
    .join(";");
}

export async function datevFile(from: string, to: string, opt: DatevOptions = {}) {
  const cfg = await bookConfig();
  checkDatev(cfg, from, to);
  const { rows, purchaseIds } = await datevRows(from, to, cfg, opt);
  const header = extfHeader(cfg, "stapel", from, to);
  const cols = ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext"].join(";");
  const lines = rows.map((r) => [num(r.amount), q(r.sh), q("EUR"), "", "", "", r.konto, r.gegen, r.bu ? q(r.bu) : "", ddmm(r.date), q(r.beleg), "", "", q(r.text)].join(";"));
  const body = cp1252([header, cols, ...lines].join("\r\n") + "\r\n");
  return { body, count: rows.length, rows, purchaseIds, name: `EXTF_Buchungsstapel_${from}_${to}.csv` };
}

/** Debitoren-Stammdaten (EXTF Kategorie 16) aller Kunden mit eigenem Personenkonto 10000–69999 – plus Sammelkonten */
export async function datevStammdaten(cfg: BookConfig, from: string, to: string) {
  const a = ACC[cfg.datevSkr];
  const customers = await db.customer.findMany({ where: { number: { gte: 10000, lte: 69999 } }, orderBy: { number: "asc" } });
  const cols = [
    "Konto", "Name (Adressatentyp Unternehmen)", "Unternehmensgegenstand", "Name (Adressatentyp natürl. Person)", "Vorname (Adressatentyp natürl. Person)", "Name (Adressatentyp keine Angabe)", "Adressatentyp", "Kurzbezeichnung", "EU-Land", "EU-UStID",
    "Anrede", "Titel/Akad. Grad", "Adelstitel", "Namensvorsatz", "Adressart", "Straße", "Postfach", "Postleitzahl", "Ort", "Land",
    "Versandzusatz", "Adresszusatz", "Abweichende Anrede", "Abw. Zustellbezeichnung 1", "Abw. Zustellbezeichnung 2", "Kennz. Korrespondenzadresse", "Adresse Gültig von", "Adresse Gültig bis", "Telefon", "Bemerkung (Telefon)",
    "Telefon GL", "Bemerkung (Telefon GL)", "E-Mail", "Bemerkung (E-Mail)", "Internet",
  ];
  const t = (s: string | null | undefined, max: number) => (s ? q(s.replace(/[\r\n;]+/g, " ").trim().slice(0, max)) : "");
  const line = (c: { konto: number; firma?: string | null; nach?: string | null; vor?: string | null; kurz: string; vat?: string | null; anrede?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; phone?: string | null; email?: string | null }) => {
    const person = !c.firma && !!c.nach;
    const vat = c.vat?.replace(/\s+/g, "").toUpperCase() ?? "";
    const v = Array<string>(cols.length).fill("");
    v[0] = String(c.konto);
    if (person) { v[3] = t(c.nach, 30); v[4] = t(c.vor, 30); v[6] = q("1"); }
    else { v[1] = t(c.firma ?? c.kurz, 50); v[6] = q("2"); }
    v[7] = t(c.kurz, 15);
    if (/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vat)) { v[8] = q(vat.slice(0, 2)); v[9] = q(vat.slice(2)); }
    if (person) v[10] = t(c.anrede, 30);
    if (c.street || c.zip || c.city) { v[14] = q("STR"); v[15] = t(c.street, 36); v[17] = t(c.zip, 10); v[18] = t(c.city, 30); v[19] = c.country && c.country !== "DE" ? t(c.country, 2) : ""; }
    v[28] = t(c.phone, 60);
    v[32] = t(c.email, 60);
    return v.join(";");
  };
  const lines = [
    line({ konto: a.debitor, firma: "Diverse Kunden (Sammeldebitor)", kurz: "Div. Kunden" }),
    line({ konto: a.creditor, firma: "Diverse Lieferanten (Sammelkreditor)", kurz: "Div. Lieferant" }),
    ...customers.map((c) =>
      line({ konto: c.number!, firma: c.kind === "PERSON" ? null : c.name, nach: c.kind === "PERSON" ? c.lastName || c.name : null, vor: c.firstName, kurz: c.name, vat: c.vatId, anrede: c.salutation, street: c.street, zip: c.zip, city: c.city, country: c.country, phone: c.phone, email: c.email }),
    ),
  ];
  const body = cp1252([extfHeader(cfg, "stamm", from, to), cols.join(";"), ...lines].join("\r\n") + "\r\n");
  return { body, count: customers.length, name: `EXTF_Debitoren_Kreditoren_${from.slice(0, 4)}.csv` };
}

export { cp1252 };
