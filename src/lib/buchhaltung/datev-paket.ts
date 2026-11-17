import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { berlinParts } from "@/lib/berlin";
import { safeName, zip, type ZipEntry } from "@/lib/zip";
import { bookConfig } from "./config";
import { checkDatev, datevFile, datevRows, datevStammdaten, type DatevOptions } from "./datev";

// DATEV-Paket für den Steuerberater: ein ZIP mit
//  • EXTF-Buchungsstapel (Rechnungen, Zahlungen, Ausgaben, deren Bezahlung)
//  • EXTF-Debitoren-Stammdaten (Kunden mit Personenkonto + Sammelkonten)
//  • Belegbilder je Belegart als eigenes ZIP mit document.xml (für DATEV Belegtransfer / Unternehmen online)
//  • Lies_mich.txt mit Zahlen und Anleitung
// Die Belegdateien heißen wie „Belegfeld 1“ im Stapel (Rechnungsnummer bzw. E-Nummer), damit DATEV sie zuordnen kann.
// Nur lesen – außer dem Merker „exportiert“ an den Ausgaben (wie beim reinen Stapel-Export).

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ext = (mime: string, name: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "dat";
};
/** DATEV nimmt PDF und gängige Bilder; anderes (z. B. HEIC/WebP) bleibt draußen und wird gemeldet */
const DATEV_TYPES = new Set(["pdf", "jpg", "jpeg", "png", "tif", "tiff"]);

type Beleg = { name: string; data: Uint8Array; date: Date; description: string };

/** Belegbilder-ZIP mit document.xml (DATEV-XML-Schnittstelle, Dokumente ohne Buchungsdaten) */
function belegZip(belege: Beleg[], title: string) {
  const now = berlinParts(new Date());
  const docs = belege
    .map((b) => `    <document guid="${randomUUID()}">\n      <description>${xmlEsc(b.description.slice(0, 120))}</description>\n      <extension xsi:type="File" name="${xmlEsc(b.name)}"/>\n    </document>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<archive xmlns="http://xml.datev.de/bedi/tps/document/v06.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://xml.datev.de/bedi/tps/document/v06.0 Document_v060.xsd" version="6.0" generatingSystem="Jarvis ProMont">
  <header>
    <date>${now.ymd}T${String(now.h).padStart(2, "0")}:${String(now.min).padStart(2, "0")}:00</date>
    <description>${xmlEsc(title)}</description>
  </header>
  <content>
${docs}
  </content>
</archive>
`;
  return zip([{ name: "document.xml", data: new TextEncoder().encode(xml) }, ...belege.map((b) => ({ name: b.name, data: b.data, date: b.date }))]);
}

/** Zahlen für die Seite /buchhaltung/datev (nichts wird verändert) */
export async function datevPreview(from: string, to: string, opt: DatevOptions = {}) {
  const cfg = await bookConfig();
  const { rows, purchaseIds, skipped } = await datevRows(from, to, cfg, opt);
  const salesIds = [...new Set(rows.map((r) => r.ref?.sales).filter((x): x is string => !!x))];
  const [sales, purchases, customers, unknownDebitor] = await Promise.all([
    db.salesDoc.findMany({ where: { id: { in: salesIds } }, select: { id: true, number: true, kind: true, grossCents: true, pdf: false, sha256: true, imported: true } }),
    db.purchaseDoc.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, number: true, supplier: true, grossCents: true, fileId: true, exportedAt: true } }),
    db.customer.count({ where: { number: { gte: 10000, lte: 69999 } } }),
    db.customer.count({ where: { OR: [{ number: null }, { number: { lt: 10000 } }, { number: { gt: 69999 } }] } }),
  ]);
  const withPdf = await db.salesDoc.count({ where: { id: { in: salesIds }, pdf: { not: null } } });
  const sum = (sh: "S" | "H", f: (r: (typeof rows)[number]) => boolean) => rows.filter((r) => r.sh === sh && f(r)).reduce((s, r) => s + r.amount, 0);
  return {
    cfg,
    rows: rows.length,
    sample: rows.slice(0, 12),
    invoices: sales.filter((d) => d.kind === "RECHNUNG").length,
    credits: sales.filter((d) => d.kind === "GUTSCHRIFT").length,
    invoicesWithoutPdf: sales.length - withPdf,
    purchases: purchases.length,
    purchasesWithoutFile: purchases.filter((p) => !p.fileId),
    alreadyExported: purchases.filter((p) => p.exportedAt).length,
    revenue: sum("S", (r) => !!r.ref?.sales) - sum("H", (r) => !!r.ref?.sales),
    expenses: sum("S", (r) => !!r.ref?.purchase) - sum("H", (r) => !!r.ref?.purchase),
    payments: rows.filter((r) => !r.ref).length,
    customers,
    unknownDebitor,
    skipped,
  };
}

export async function datevPaket(from: string, to: string, opt: DatevOptions = {}) {
  const cfg = await bookConfig();
  checkDatev(cfg, from, to);
  const [stapel, stamm] = await Promise.all([datevFile(from, to, opt), datevStammdaten(cfg, from, to)]);
  const salesIds = [...new Set(stapel.rows.map((r) => r.ref?.sales).filter((x): x is string => !!x))];
  const purchaseIds = [...new Set(stapel.rows.map((r) => r.ref?.purchase).filter((x): x is string => !!x))];

  // Ausgangsrechnungen: archiviertes PDF (ZUGFeRD) – beim Festschreiben erzeugt, unverändert
  const sales = await db.salesDoc.findMany({ where: { id: { in: salesIds } }, orderBy: [{ date: "asc" }, { number: "asc" }], select: { id: true, kind: true, number: true, date: true, pdf: true, grossCents: true, customer: { select: { name: true } }, address: true } });
  const out: Beleg[] = [];
  const missing: string[] = [];
  for (const d of sales) {
    const label = `${d.kind === "GUTSCHRIFT" ? "Gutschrift" : "Rechnung"} ${d.number ?? ""} ${d.customer?.name ?? ""}`.trim();
    if (d.pdf) out.push({ name: `${safeName(d.number ?? d.id)}.pdf`, data: new Uint8Array(d.pdf), date: d.date, description: label });
    else missing.push(`${label} – kein archiviertes PDF`);
  }
  // Eingangsbelege: Foto/PDF aus „Beleg fotografieren“ bzw. Ausgaben
  const purchases = await db.purchaseDoc.findMany({ where: { id: { in: purchaseIds } }, orderBy: [{ date: "asc" }, { number: "asc" }], select: { id: true, number: true, supplier: true, docNo: true, date: true, fileId: true } });
  const files = await db.storedFile.findMany({ where: { id: { in: purchases.map((p) => p.fileId).filter((x): x is string => !!x) } }, select: { id: true, name: true, mime: true, data: true } });
  const fileById = new Map(files.map((f) => [f.id, f]));
  const inc: Beleg[] = [];
  for (const p of purchases) {
    const label = `${p.number} ${p.supplier}${p.docNo ? ` (Rg. ${p.docNo})` : ""}`;
    const f = p.fileId ? fileById.get(p.fileId) : null;
    const e = f ? ext(f.mime, f.name) : "";
    if (f && DATEV_TYPES.has(e)) inc.push({ name: `${safeName(p.number)}.${e === "jpeg" ? "jpg" : e}`, data: new Uint8Array(f.data), date: p.date, description: label });
    else missing.push(`${label} – ${f ? `Dateiformat .${e} nimmt DATEV nicht` : "kein Belegfoto"}`);
  }

  const entries: ZipEntry[] = [
    { name: stapel.name, data: new Uint8Array(stapel.body) },
    { name: stamm.name, data: new Uint8Array(stamm.body) },
  ];
  if (out.length) entries.push({ name: `Belege_Rechnungsausgang_${from}_${to}.zip`, data: new Uint8Array(belegZip(out, `Rechnungsausgang ${from} bis ${to}`)) });
  if (inc.length) entries.push({ name: `Belege_Rechnungseingang_${from}_${to}.zip`, data: new Uint8Array(belegZip(inc, `Rechnungseingang ${from} bis ${to}`)) });
  const readme = [
    `DATEV-Paket ProMont GmbH – Zeitraum ${from} bis ${to}`,
    `Berater ${cfg.datevBerater}, Mandant ${cfg.datevMandant}, SKR ${cfg.datevSkr}, erstellt ${berlinParts().ymd} mit Jarvis`,
    "",
    `1. ${stapel.name}: ${stapel.count} Buchungen (EXTF 700, Buchungsstapel) – in DATEV Rechnungswesen über Stapelverarbeitung → Import → ASCII-Daten einlesen.`,
    `2. ${stamm.name}: ${stamm.count} Kunden mit Personenkonto + Sammeldebitor/-kreditor (EXTF, Debitoren/Kreditoren).`,
    `3. Belege_Rechnungsausgang_*.zip (${out.length}) und Belege_Rechnungseingang_*.zip (${inc.length}): Belegbilder mit document.xml – unverändert per DATEV Belegtransfer bzw. Upload in DATEV Unternehmen online in den passenden Belegordner laden.`,
    "   Dateiname = Belegfeld 1 im Buchungsstapel (Rechnungsnummer bzw. Eingangsnummer E-JJJJ-0001).",
    "",
    "Konten: Kunden mit Kundennummer 10000–69999 bekommen ihr eigenes Debitorenkonto, alle anderen den Sammeldebitor 10000; Ausgaben laufen über den Sammelkreditor 70000.",
    "Aus Lexware übernommene Altbelege sind nur enthalten, wenn das beim Export ausdrücklich gewählt wurde.",
    ...(missing.length ? ["", `Ohne Belegbild (${missing.length}):`, ...missing.map((m) => `- ${m}`)] : []),
  ].join("\r\n");
  entries.push({ name: "Lies_mich.txt", data: Buffer.from(`﻿${readme}\r\n`, "utf8") });
  return { data: zip(entries), purchaseIds: stapel.purchaseIds, name: `DATEV_ProMont_${from}_${to}.zip` };
}
