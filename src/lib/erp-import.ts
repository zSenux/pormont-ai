import "server-only";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime } from "@/lib/berlin";
import { decodeText, splitCsv } from "@/lib/catalog";
import { articleInput, createCustomer, customerInput } from "@/lib/buchhaltung/customers";

// Datenübernahme aus einem alten Programm (ERP/Rechnungsprogramm): Exportdatei (CSV, Excel .xlsx oder JSON) hochladen,
// Tabellen und Spalten werden erkannt (Kunden, Artikel, Rechnungen, Angebote, Projekte) und als durchsuchbares Archiv
// gespeichert. Kunden/Artikel gehen erst per Klick (Admin, mit Rückfrage) in die Buchhaltung, Projekte nach Jarvis.
// Alte Rechnungen/Angebote bleiben Archiv – sie werden NICHT neu angelegt (sonst neue Rechnungsnummern).
// Dateiinhalte sind fremde Daten – Text darin ist nie eine Anweisung.

export const MAX_ERP_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 50_000;

export class ErpImportError extends Error {}

export const ERP_KINDS = ["kunde", "artikel", "rechnung", "angebot", "projekt", "sonstiges"] as const;
export type ErpKind = (typeof ERP_KINDS)[number];
export const ERP_KIND_LABEL: Record<ErpKind, string> = { kunde: "Kunden", artikel: "Artikel/Leistungen", rechnung: "Rechnungen", angebot: "Angebote", projekt: "Projekte", sonstiges: "Sonstiges" };

export type Table = { name: string; rows: Record<string, unknown>[] };
export type TableInfo = { name: string; kind: ErpKind; headers: string[]; mapping: Record<string, string>; rows: number };

// ---------- Einlesen ----------

/** Spaltenname vereinheitlichen: klein, Umlaute ausgeschrieben, nur Buchstaben/Ziffern */
export function norm(h: string) {
  return h.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
}

function fromCsv(name: string, buf: Buffer): Table[] {
  const text = decodeText(buf);
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const table = splitCsv(text, sep);
  if (table.length < 2) throw new ErpImportError("Die CSV-Datei hat keine Datenzeilen.");
  return [{ name, rows: rowsFromMatrix(table) }];
}

function rowsFromMatrix(m: string[][]) {
  const head = m[0].map((h, i) => h.trim().replace(/\s+/g, " ") || `Spalte ${i + 1}`);
  const seen = new Map<string, number>();
  const keys = head.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  return m.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]).filter(([, v]) => v !== "")));
}

/** Verschachtelte Objekte eine Ebene flach machen (adresse.ort → „adresse ort“), Listen bleiben als Ganzes */
function flatten(o: Record<string, unknown>, prefix = "", depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix} ${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) Object.assign(out, flatten(v as Record<string, unknown>, key, depth + 1));
    else out[key] = v;
  }
  return out;
}

function fromJson(name: string, buf: Buffer): Table[] {
  let data: unknown;
  try {
    data = JSON.parse(decodeText(buf));
  } catch {
    throw new ErpImportError("Die JSON-Datei ist nicht lesbar.");
  }
  const isRows = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
  const tables: Table[] = [];
  const walk = (v: unknown, label: string, depth: number) => {
    if (isRows(v)) tables.push({ name: label, rows: v.map((r) => flatten(r)) });
    else if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(data, name, 0);
  if (!tables.length) throw new ErpImportError("In der JSON-Datei wurden keine Listen mit Datensätzen gefunden.");
  return tables;
}

// --- Excel (.xlsx = ZIP mit XML) ohne Zusatzpaket ---
function unzip(buf: Buffer) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ErpImportError("Die Excel-Datei ist beschädigt.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, () => Buffer>();
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 200 * 1024 * 1024 });
      throw new ErpImportError("Die Excel-Datei ist ungewöhnlich gepackt – bitte als CSV speichern.");
    });
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const xmlText = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const tTexts = (s: string) => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join("");

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Alle Blätter einer .xlsx als Zeilen/Spalten (Text). Auch für Lieferanten-Preislisten (catalog.ts). */
export function xlsxSheets(buf: Buffer): { name: string; matrix: string[][] }[] {
  const files = unzip(buf);
  const read = (n: string) => files.get(n)?.().toString("utf8") ?? "";
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tTexts(m[1]));
  const rels = new Map([...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? "", /Target="([^"]+)"/.exec(m[0])?.[1] ?? ""]));
  // Datumszellen erkennen (Excel speichert Tage seit 1900 + Zahlenformat im Stil)
  const styles = read("xl/styles.xml");
  const customFmt = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(/numFmtId="(\d+)"/.exec(m[0])?.[1]), xmlText(/formatCode="([^"]*)"/.exec(m[0])?.[1] ?? "")]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    const code = customFmt.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test(code);
  });
  const serialToDe = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 80000) return v;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    const day = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
    return n % 1 ? `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : day;
  };
  const sheets = [...read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: xmlText(/name="([^"]*)"/.exec(m[0])?.[1] ?? "Blatt"), rid: /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "" }));
  const out: { name: string; matrix: string[][] }[] = [];
  for (const s of sheets) {
    const target = rels.get(s.rid);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = read(path);
    const matrix: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      let auto = 0;
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : auto;
        auto = idx + 1;
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const inner = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val = "";
        if (t === "s") val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = tTexts(inner);
        else if (t === "b") val = v === "1" ? "ja" : "nein";
        else val = v !== undefined ? xmlText(v) : "";
        const st = /\ss="(\d+)"/.exec(" " + attrs)?.[1];
        if ((!t || t === "n") && v !== undefined && st && dateStyle[Number(st)]) val = serialToDe(val);
        cells[idx] = val;
      }
      if (cells.some((x) => x && x.trim())) matrix.push(Array.from(cells, (x) => x ?? ""));
    }
    out.push({ name: s.name, matrix });
  }
  return out;
}

function fromXlsx(buf: Buffer): Table[] {
  const tables: Table[] = xlsxSheets(buf).filter((s) => s.matrix.length >= 2).map((s) => ({ name: s.name, rows: rowsFromMatrix(s.matrix) }));
  if (!tables.length) throw new ErpImportError("In der Excel-Datei wurde kein Blatt mit Kopfzeile und Daten gefunden.");
  return tables;
}

export function parseExport(fileName: string, buf: Buffer): { format: string; tables: Table[] } {
  const lower = fileName.toLowerCase();
  if (buf.subarray(0, 2).toString() === "PK" || lower.endsWith(".xlsx")) return { format: "xlsx", tables: fromXlsx(buf) };
  if (lower.endsWith(".xls")) throw new ErpImportError("Altes Excel-Format (.xls) – bitte als .xlsx oder CSV speichern.");
  const head = buf.subarray(0, 200).toString("utf8").replace(/^﻿/, "").trimStart();
  if (lower.endsWith(".json") || head.startsWith("{") || head.startsWith("[")) return { format: "json", tables: fromJson(fileName.replace(/\.[^.]+$/, ""), buf) };
  return { format: "csv", tables: fromCsv(fileName.replace(/\.[^.]+$/, ""), buf) };
}

// ---------- Erkennen ----------

const FIELDS: Record<Exclude<ErpKind, "sonstiges">, Record<string, RegExp>> = {
  kunde: {
    nummer: /^(kundennr|kundennummer|kdnr|kundenid|debitorennr|debitor|nr|nummer|id|customerid|customernumber|number)$/,
    name: /^(firma|firmenname|name|kunde|kundenname|company|companyname|customer|customername|unternehmen|bezeichnung|name1)$/,
    anrede: /^(anrede|salutation)$/,
    vorname: /^(vorname|firstname)$/,
    nachname: /^(nachname|lastname|ansprechpartner|kontakt|kontaktperson|contact|contactperson|name2)$/,
    email: /^(email|mail|emailadresse|emailaddress)$/,
    telefon: /^(telefon|tel|phone|telefonnummer|mobil|handy|mobile|telefon1)$/,
    strasse: /^(strasse|str|adresse|anschrift|street|address|strassehausnummer|adressestrasse|addressstreet)$/,
    plz: /^(plz|postleitzahl|zip|zipcode|postalcode|adresseplz|addresszip)$/,
    ort: /^(ort|stadt|city|wohnort|adresseort|addresscity)$/,
    notiz: /^(notiz|notizen|bemerkung|bemerkungen|note|notes|info|hinweis)$/,
  },
  artikel: {
    nummer: /^(artikelnr|artikelnummer|artnr|nr|nummer|id|sku|positionsnr|leistungsnr)$/,
    name: /^(bezeichnung|artikel|artikelbezeichnung|name|titel|title|leistung|produkt|kurztext|position)$/,
    beschreibung: /^(beschreibung|langtext|description|details|text)$/,
    einheit: /^(einheit|me|mengeneinheit|unit|unitname)$/,
    preis: /^(vk|ek)?(preis|vk|nettopreis|einzelpreis|ep|price|netprice|stundensatz|verkaufspreis|listenpreis)(netto|eur|euro|ineur)?$/,
    ust: /^(ust|mwst|steuersatz|ustsatz|mwstsatz|tax|taxrate|steuer)$/,
  },
  rechnung: {
    nummer: /^(rechnungsnr|rechnungsnummer|renr|rgnr|belegnr|belegnummer|nr|nummer|id|number|invoicenumber|invoiceno)$/,
    kunde: /^(kunde|kundenname|firma|empfaenger|name|customer|customername|auftraggeber|kundefirma|kundename)$/,
    datum: /^(datum|rechnungsdatum|belegdatum|date|erstellt|erstelltam|createdat|invoicedate)$/,
    faellig: /^(faellig|faelligam|faelligkeit|zahlungsziel|duedate|faelligkeitsdatum)$/,
    brutto: /^(brutto|betrag|summe|gesamt|gesamtbetrag|bruttobetrag|endbetrag|total|amount|betragbrutto|summebrutto|gesamtbrutto|totalgross|rechnungsbetrag)$/,
    netto: /^(netto|nettobetrag|summenetto|betragnetto|gesamtnetto|subtotal|totalnet)$/,
    status: /^(status|zustand|bezahlt|zahlstatus|paid)$/,
    titel: /^(titel|betreff|bezeichnung|title|subject|projekt|bauvorhaben|leistung)$/,
  },
  angebot: {
    nummer: /^(angebotsnr|angebotsnummer|angnr|belegnr|belegnummer|nr|nummer|id|number|quotenumber)$/,
    kunde: /^(kunde|kundenname|firma|empfaenger|name|customer|customername|auftraggeber|kundefirma|kundename)$/,
    datum: /^(datum|angebotsdatum|belegdatum|date|erstellt|erstelltam|createdat)$/,
    faellig: /^(gueltigbis|gueltig|bindefrist|validuntil|ablauf)$/,
    brutto: /^(brutto|betrag|summe|gesamt|gesamtbetrag|bruttobetrag|endbetrag|total|amount|betragbrutto|summebrutto|angebotssumme)$/,
    netto: /^(netto|nettobetrag|summenetto|betragnetto|gesamtnetto|subtotal)$/,
    status: /^(status|zustand|angenommen)$/,
    titel: /^(titel|betreff|bezeichnung|title|subject|projekt|bauvorhaben|leistung)$/,
  },
  projekt: {
    nummer: /^(projektnr|projektnummer|auftragsnr|auftragsnummer|nr|nummer|id)$/,
    name: /^(projekt|projektname|name|titel|bezeichnung|bauvorhaben|auftrag|title)$/,
    kunde: /^(kunde|auftraggeber|bauherr|customer|firma|kundenname)$/,
    adresse: /^(adresse|baustelle|ort|anschrift|address|baustellenadresse)$/,
    status: /^(status|zustand)$/,
    start: /^(start|beginn|startdatum|von|begin|startdate)$/,
    ende: /^(ende|enddatum|bis|fertigstellung|end|enddate)$/,
    beschreibung: /^(beschreibung|notiz|notizen|bemerkung|description)$/,
  },
};

// Spalten, die eine Art eindeutig verraten
const STRONG: Partial<Record<ErpKind, RegExp>> = {
  rechnung: /^(rechnungsnr|rechnungsnummer|renr|rgnr|rechnungsdatum|invoicenumber|rechnungsbetrag)$/,
  angebot: /^(angebotsnr|angebotsnummer|angebotsdatum|gueltigbis|bindefrist|angebotssumme|quotenumber)$/,
  artikel: /^(artikelnr|artikelnummer|artnr|einheit|mengeneinheit|vkpreis|einzelpreis|sku)$/,
  kunde: /^(kundennr|kundennummer|plz|postleitzahl|email|telefon|ansprechpartner)$/,
  projekt: /^(projektnr|projektnummer|baustelle|bauherr|beginn|fertigstellung)$/,
};
const NAME_HINT: Partial<Record<ErpKind, RegExp>> = {
  kunde: /kunde|customer|client|kontakt|debitor/i,
  artikel: /artikel|leistung|product|produkt|item|material|preisliste/i,
  rechnung: /rechnung|invoice|faktur/i,
  angebot: /angebot|quote|offer|kostenvoranschlag/i,
  projekt: /projekt|project|auftr|baustelle/i,
};

export function mapColumns(kind: ErpKind, headers: string[]) {
  const mapping: Record<string, string> = {};
  if (kind === "sonstiges") return mapping;
  const used = new Set<string>();
  for (const [field, re] of Object.entries(FIELDS[kind])) {
    const h = headers.find((x) => !used.has(x) && re.test(norm(x)));
    if (h) (mapping[field] = h), used.add(h);
  }
  return mapping;
}

export function detectKind(tableName: string, headers: string[]): ErpKind {
  let best: ErpKind = "sonstiges";
  let bestScore = 1;
  for (const kind of ERP_KINDS) {
    if (kind === "sonstiges") continue;
    let score = Object.keys(mapColumns(kind, headers)).length;
    score += headers.filter((h) => STRONG[kind]?.test(norm(h))).length * 2;
    if (NAME_HINT[kind]?.test(tableName)) score += 4;
    if (score > bestScore) (best = kind), (bestScore = score);
  }
  return best;
}

// ---------- Werte ----------

const str = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim();

/** „1.234,50 €“, „1234.50“, „-12,5“ → Zahl */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = str(v).replace(/[€\s]|EUR/gi, "");
  if (!s) return null;
  if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 100_000_000 ? Math.round(n * 100) / 100 : null;
}

/** „11.11.2026“, „2026-11-11“, ISO mit Uhrzeit oder Excel-Seriennummer → Datum (Berlin) */
export function parseDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  let ymd: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) ymd = `${m[1]}-${m[2]}-${m[3]}`;
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s))) ymd = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) ymd = new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  if (!ymd) return null;
  const d = berlinDateTime(ymd, "12:00");
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100 ? null : d;
}

function recordFrom(kind: ErpKind, mapping: Record<string, string>, row: Record<string, unknown>) {
  const f = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, str(row[h]).slice(0, 2000)]).filter(([, v]) => v)) as Record<string, string>;
  const person = [f.vorname, f.nachname].filter(Boolean).join(" ");
  const name = (kind === "kunde" ? f.name || person : kind === "rechnung" || kind === "angebot" ? f.titel : f.name) || null;
  const amount = kind === "artikel" ? parseAmount(f.preis) : kind === "rechnung" || kind === "angebot" ? (parseAmount(f.brutto) ?? parseAmount(f.netto)) : null;
  const date = kind === "projekt" ? parseDate(f.start) : parseDate(f.datum);
  const dueDate = kind === "projekt" ? parseDate(f.ende) : parseDate(f.faellig);
  const fallbackName = kind === "sonstiges" ? Object.values(row).map(str).find((x) => x && !/^\d+$/.test(x)) : undefined;
  const search = Object.values(row).map(str).join(" ").toLowerCase().slice(0, 4000);
  return {
    kind,
    number: f.nummer?.slice(0, 80) || null,
    name: (name ?? fallbackName ?? null)?.slice(0, 300) ?? null,
    party: (f.kunde ?? null)?.slice(0, 300) ?? null,
    date,
    dueDate,
    amount,
    status: f.status?.slice(0, 60) || null,
    fields: f,
    raw: JSON.parse(JSON.stringify(row)) as object,
    search,
  };
}

// ---------- Import ----------

export async function importExport(opts: { fileName: string; data: Buffer; userName: string }) {
  const { format, tables } = parseExport(opts.fileName, opts.data);
  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  if (total > MAX_ROWS) throw new ErpImportError(`Zu viele Zeilen (${total.toLocaleString("de-DE")}) – höchstens ${MAX_ROWS.toLocaleString("de-DE")} je Datei. Bitte aufteilen.`);
  const infos: TableInfo[] = tables.map((t) => {
    const headers = [...new Set(t.rows.flatMap((r) => Object.keys(r)))].slice(0, 200);
    const kind = detectKind(t.name, headers);
    return { name: t.name.slice(0, 120), kind, headers, mapping: mapColumns(kind, headers), rows: t.rows.length };
  });
  const imp = await db.erpImport.create({ data: { fileName: opts.fileName.slice(0, 200), format, tables: infos as object[], rows: total, userName: opts.userName } });
  for (let t = 0; t < tables.length; t++) {
    const info = infos[t];
    const recs = tables[t].rows.map((r) => ({ importId: imp.id, table: info.name, ...recordFrom(info.kind, info.mapping, r) }));
    for (let i = 0; i < recs.length; i += 1000) await db.erpRecord.createMany({ data: recs.slice(i, i + 1000) });
  }
  return { id: imp.id, format, tables: infos };
}

/** Art einer Tabelle von Hand ändern → Spalten neu zuordnen, Datensätze neu aufbauen (Originalzeilen bleiben) */
export async function changeTableKind(importId: string, table: string, kind: ErpKind) {
  const imp = await db.erpImport.findUniqueOrThrow({ where: { id: importId } });
  const infos = (imp.tables ?? []) as TableInfo[];
  const info = infos.find((t) => t.name === table);
  if (!info) throw new ErpImportError("Tabelle nicht gefunden.");
  const moved = await db.erpRecord.count({ where: { importId, table, OR: [{ lexId: { not: null } }, { projectId: { not: null } }] } });
  if (moved) throw new ErpImportError("Aus dieser Tabelle wurde schon etwas übernommen – Art kann nicht mehr geändert werden.");
  info.kind = kind;
  info.mapping = mapColumns(kind, info.headers);
  const recs = await db.erpRecord.findMany({ where: { importId, table }, select: { id: true, raw: true } });
  for (const r of recs) {
    const { raw: _raw, ...data } = recordFrom(kind, info.mapping, r.raw as Record<string, unknown>);
    void _raw;
    await db.erpRecord.update({ where: { id: r.id }, data: { ...data, error: null } });
  }
  await db.erpImport.update({ where: { id: importId }, data: { tables: infos as object[] } });
}

// ---------- Übernahme ----------

/** Sperre je Import (eine Übernahme gleichzeitig, hängende Sperren verfallen nach 30 Min.) */
export async function claim(importId: string, what: "kunde" | "artikel" | "projekt") {
  const stale = new Date(Date.now() - 30 * 60_000);
  const r = await db.erpImport.updateMany({ where: { id: importId, OR: [{ busy: null }, { busySince: { lt: stale } }] }, data: { busy: what, busySince: new Date() } });
  return r.count > 0;
}
const release = (importId: string) => db.erpImport.update({ where: { id: importId }, data: { busy: null, busySince: null } });

const errText = (e: unknown) => (e instanceof z.ZodError ? (e.issues[0]?.message ?? "Ungültig") : e instanceof Error ? e.message : "Fehler").slice(0, 300);

/** Kunden in die Buchhaltung: vorhandene (gleicher Name) werden nur verknüpft, nicht doppelt angelegt. lexId = ID des Ziel-Datensatzes */
export async function transferCustomers(importId: string) {
  try {
    const recs = await db.erpRecord.findMany({ where: { importId, kind: "kunde", lexId: null }, orderBy: { createdAt: "asc" } });
    for (const r of recs) {
      try {
        const f = r.fields as Record<string, string>;
        const firma = f.name?.trim() || undefined;
        // „Herr Schneider“ / „Frau Anna Becker“ → Anrede + Vor-/Nachname
        let anrede = f.anrede;
        let vorname = f.vorname;
        let nachname = f.nachname?.trim();
        const m = nachname ? /^(Herr|Frau)\s+(.+)$/i.exec(nachname) : null;
        if (m) (anrede = anrede || m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()), (nachname = m[2]);
        if (nachname && !vorname && /\s/.test(nachname)) (vorname = nachname.slice(0, nachname.lastIndexOf(" "))), (nachname = nachname.slice(nachname.lastIndexOf(" ") + 1));
        const email = z.email().safeParse(f.email).success ? f.email : null;
        const input = customerInput.parse({
          kind: firma ? "FIRMA" : "PERSON",
          company: firma?.slice(0, 200),
          salutation: anrede?.slice(0, 25),
          firstName: vorname?.slice(0, 100),
          lastName: nachname?.slice(0, 100),
          contactName: firma && (vorname || nachname) ? [vorname, nachname].filter(Boolean).join(" ").slice(0, 150) : undefined,
          email,
          phone: f.telefon?.slice(0, 40),
          street: f.strasse?.slice(0, 150),
          zip: f.plz?.slice(0, 10),
          city: f.ort?.slice(0, 100),
          notes: [f.notiz, r.number ? `Kundennr. im alten Programm: ${r.number}` : null].filter(Boolean).join("\n").slice(0, 4000) || undefined,
        });
        const name = (firma ?? [input.firstName, input.lastName].filter(Boolean).join(" ")).trim();
        const same = name ? await db.customer.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } }) : null;
        const id = same?.id ?? (await createCustomer(input)).id;
        await db.erpRecord.update({ where: { id: r.id }, data: { lexId: id, error: null } });
      } catch (e) {
        await db.erpRecord.update({ where: { id: r.id }, data: { error: errText(e) } });
      }
    }
  } finally {
    await release(importId);
  }
}

/** Artikel/Leistungen in den Artikelstamm (gleiche Artikelnummer bzw. gleicher Name → nur verknüpfen) */
export async function transferArticles(importId: string) {
  try {
    const recs = await db.erpRecord.findMany({ where: { importId, kind: "artikel", lexId: null }, orderBy: { createdAt: "asc" } });
    for (const r of recs) {
      try {
        const f = r.fields as Record<string, string>;
        if (!r.name) throw new Error("Bezeichnung fehlt.");
        if (r.amount === null || r.amount < 0) throw new Error("Preis fehlt.");
        const same = await db.article.findFirst({ where: r.number ? { number: r.number } : { name: { equals: r.name, mode: "insensitive" } }, select: { id: true } });
        if (same) {
          await db.erpRecord.update({ where: { id: r.id }, data: { lexId: same.id, error: null } });
          continue;
        }
        const unit = (f.einheit || "Stk").slice(0, 30);
        const tax = parseAmount(f.ust);
        const a = articleInput.parse({
          number: r.number?.slice(0, 40),
          name: r.name.slice(0, 300),
          description: f.beschreibung?.slice(0, 4000),
          unit,
          priceNet: Math.round(r.amount * 10000) / 10000,
          taxRate: tax === 0 || tax === 7 ? tax : 19,
          kind: /^(std|h|stunde|stunden|std\.)$/i.test(unit) ? "LEISTUNG" : "MATERIAL",
        });
        const created = await db.article.create({ data: a });
        await db.erpRecord.update({ where: { id: r.id }, data: { lexId: created.id, error: null } });
      } catch (e) {
        await db.erpRecord.update({ where: { id: r.id }, data: { error: errText(e) } });
      }
    }
  } finally {
    await release(importId);
  }
}

const PROJECT_STATUS = (s?: string) => (!s ? "LAEUFT" : /fertig|abgeschl|erledigt|done|beendet/i.test(s) ? "FERTIG" : /plan|angebot|offen|neu/i.test(s) ? "PLANUNG" : /pause|ruht/i.test(s) ? "PAUSIERT" : "LAEUFT") as "LAEUFT" | "FERTIG" | "PLANUNG" | "PAUSIERT";

/** Projekte als Jarvis-Projekte anlegen (lokal, gleiche Namen werden verknüpft) */
export async function transferProjects(importId: string, userId: string) {
  let created = 0;
  try {
    const recs = await db.erpRecord.findMany({ where: { importId, kind: "projekt", projectId: null }, orderBy: { createdAt: "asc" } });
    for (const r of recs) {
      const f = r.fields as Record<string, string>;
      if (!r.name) {
        await db.erpRecord.update({ where: { id: r.id }, data: { error: "Projektname fehlt." } });
        continue;
      }
      const same = await db.project.findFirst({ where: { name: { equals: r.name, mode: "insensitive" } }, select: { id: true } });
      const p =
        same ??
        (await db.project.create({
          data: {
            name: r.name.slice(0, 200),
            customer: r.party?.slice(0, 200) || null,
            address: f.adresse?.slice(0, 300) || null,
            status: PROJECT_STATUS(f.status),
            startDate: r.date,
            endDate: r.dueDate,
            description: [f.beschreibung, `Übernommen aus dem alten Programm${r.number ? ` (Nr. ${r.number})` : ""}.`].filter(Boolean).join("\n\n").slice(0, 4000),
            createdById: userId,
          },
        }));
      if (!same) created++;
      await db.erpRecord.update({ where: { id: r.id }, data: { projectId: p.id, error: null } });
    }
  } finally {
    await release(importId);
  }
  return created;
}

// ---------- Suche ----------

export async function searchRecords(q: { text?: string; kind?: ErpKind; offen?: boolean; take?: number }) {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const and: object[] = words.map((w) => ({ search: { contains: w } }));
  // „offen“ = Rechnung ohne Status „bezahlt“/„storniert“ (Status leer zählt als offen)
  if (q.offen) and.push({ kind: "rechnung" }, { OR: [{ status: null }, ...["offen", "nicht", "unbezahlt", "überfällig", "faellig", "fällig", "open", "overdue"].map((w) => ({ status: { contains: w, mode: "insensitive" } })), { NOT: { OR: ["bezahlt", "paid", "storn", "erledigt", "ausgeglichen"].map((w) => ({ status: { contains: w, mode: "insensitive" } })) } }] });
  return db.erpRecord.findMany({
    where: { ...(q.kind ? { kind: q.kind } : {}), ...(and.length ? { AND: and } : {}) },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    take: q.take ?? 50,
  });
}

/** Felder eines Datensatzes für die Anzeige (Originalspalten, ohne leere) */
export function rawEntries(raw: unknown): [string, string][] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, typeof v === "object" && v !== null ? JSON.stringify(v, null, 1) : str(v)] as [string, string]).filter(([, v]) => v !== "");
}
