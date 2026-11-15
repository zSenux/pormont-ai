import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts } from "@/lib/berlin";
import { docLabel } from "./types";
import { listStatements } from "./bank";
import { safeName, zip, type ZipEntry } from "@/lib/zip";

// Ablage Buchhaltung: je Monat alle Ausgangsrechnungen (archiviertes PDF), Eingangsbelege (Foto/PDF) und Kontoauszüge –
// zum Nachschlagen und als ZIP für den Steuerberater. Nur lesen, nichts wird verändert.

export const isMonth = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: berlinDateTime(`${month}-01`), end: berlinDateTime(`${next}-01`) };
}

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export async function ablageMonth(month: string) {
  const { start, end } = monthRange(month);
  const [out, inc, statements] = await Promise.all([
    db.salesDoc.findMany({
      where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: { gte: start, lt: end } },
      orderBy: [{ date: "asc" }, { number: "asc" }],
      select: { id: true, kind: true, number: true, date: true, status: true, grossCents: true, paidCents: true, prepaidCents: true, reverseCharge: true, invoiceType: true, customer: { select: { name: true } } },
    }),
    db.purchaseDoc.findMany({ where: { date: { gte: start, lt: end } }, orderBy: [{ date: "asc" }, { number: "asc" }], select: { id: true, number: true, supplier: true, date: true, grossCents: true, status: true, fileId: true, category: true } }),
    listStatements(month),
  ]);
  return { out, inc, statements };
}

/** Anzahl Belege je Monat eines Jahres (für die Monatsleiste) */
export async function ablageYear(year: number) {
  const start = berlinDateTime(`${year}-01-01`);
  const end = berlinDateTime(`${year + 1}-01-01`);
  const [out, inc, st] = await Promise.all([
    db.salesDoc.findMany({ where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: { gte: start, lt: end } }, select: { date: true } }),
    db.purchaseDoc.findMany({ where: { date: { gte: start, lt: end } }, select: { date: true, fileId: true } }),
    listStatements(),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, out: 0, inc: 0, missing: 0, statements: 0 }));
  for (const d of out) months[Number(berlinParts(d.date).ymd.slice(5, 7)) - 1].out++;
  for (const p of inc) {
    const m = months[Number(berlinParts(p.date).ymd.slice(5, 7)) - 1];
    m.inc++;
    if (!p.fileId) m.missing++;
  }
  for (const m of months) m.statements = st.filter((s) => s.from <= `${m.month}-31` && s.to >= `${m.month}-01`).length;
  return months;
}

const ext = (mime: string, name: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "application/xml" ? "xml" : mime === "text/csv" ? "csv" : "dat";
};

/** ZIP mit allen Dateien des Monats (Ordner Ausgangsrechnungen, Eingangsbelege, Kontoauszuege) */
export async function ablageZip(month: string) {
  const { out, inc, statements } = await ablageMonth(month);
  const entries: ZipEntry[] = [];
  const pdfs = await db.salesDoc.findMany({ where: { id: { in: out.map((d) => d.id) } }, select: { id: true, pdf: true, xml: true } });
  const byId = new Map(pdfs.map((p) => [p.id, p]));
  for (const d of out) {
    const f = byId.get(d.id);
    const base = safeName(`${d.number ?? d.id}_${d.customer?.name ?? ""}`);
    if (f?.pdf) entries.push({ name: `Ausgangsrechnungen/${base}.pdf`, data: new Uint8Array(f.pdf), date: d.date });
    if (f?.xml) entries.push({ name: `Ausgangsrechnungen/${base}.xml`, data: new TextEncoder().encode(f.xml), date: d.date });
  }
  const files = await db.storedFile.findMany({ where: { id: { in: [...inc.map((p) => p.fileId).filter((x): x is string => !!x), ...statements.map((s) => s.id)] } }, select: { id: true, name: true, mime: true, data: true } });
  const fileById = new Map(files.map((f) => [f.id, f]));
  for (const p of inc) {
    const f = p.fileId ? fileById.get(p.fileId) : null;
    if (f) entries.push({ name: `Eingangsbelege/${safeName(`${p.number}_${p.supplier}`)}.${ext(f.mime, f.name)}`, data: new Uint8Array(f.data), date: p.date });
  }
  for (const s of statements) {
    const f = fileById.get(s.id);
    if (f) entries.push({ name: `Kontoauszuege/${safeName(f.name)}`, data: new Uint8Array(f.data), date: s.createdAt });
  }
  const list = [
    "Art;Nummer;Datum;Partner;Betrag brutto;Status;Datei",
    ...out.map((d) => [docLabel(d), d.number ?? "", berlinParts(d.date).ymd, d.customer?.name ?? "", (d.grossCents / 100).toFixed(2).replace(".", ","), d.status, byId.get(d.id)?.pdf ? "ja" : "fehlt"].join(";")),
    ...inc.map((p) => ["Eingangsbeleg", p.number, berlinParts(p.date).ymd, p.supplier, (p.grossCents / 100).toFixed(2).replace(".", ","), p.status, p.fileId ? "ja" : "fehlt"].join(";")),
    ...statements.map((s) => ["Kontoauszug", "", `${s.from} bis ${s.to}`, "", "", "", s.name].join(";")),
  ].map((r) => r.replace(/[\r\n]+/g, " "));
  entries.unshift({ name: "Inhalt.csv", data: Buffer.from(`﻿${list.join("\r\n")}\r\n`, "utf8") });
  return { data: zip(entries), count: entries.length - 1 };
}
