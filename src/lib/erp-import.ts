import "server-only";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime } from "@/lib/berlin";
import { decodeText, splitCsv } from "@/lib/catalog";
import { articleInput, createCustomer, customerInput } from "@/lib/buchhaltung/customers";
import { readLines } from "@/lib/buchhaltung/money";
import { FileError, storeFile } from "@/lib/files";

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

export type Table = { name: string; rows: Record<string, unknown>[]; kind?: ErpKind };
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

// --- Lexware „Daten Betriebsprüfung“ (GDPdU/IDEA-Export: ZIP mit index.xml + Tab-getrennten Textdateien) ---
// Verkauf_BP = Belegköpfe (Rechnung, Storno, Rechnungskorrektur, Lieferschein …) mit Zahlstatus, Kunde und Anschrift,
// Positionen_vk_BP = Positionen je Beleg. Beides wird zu einer Zeile je Beleg mit den Positionen zusammengeführt.
const entities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&amp;/g, "&");

type GdpduTable = { url: string; name: string; description: string; from: number; sep: string; columns: string[] };

export function gdpduIndex(xml: string): GdpduTable[] {
  return [...xml.matchAll(/<Table>([\s\S]*?)<\/Table>/g)].map((m) => {
    const t = m[1];
    const columns = [...t.matchAll(/<(?:VariableColumn|VariablePrimaryKey)>\s*<Name>([\s\S]*?)<\/Name>/g)].map((c) => entities(c[1]).trim());
    const sepRaw = /<ColumnDelimiter>([\s\S]*?)<\/ColumnDelimiter>/.exec(t)?.[1] ?? "\t";
    return {
      url: entities(/<URL>([\s\S]*?)<\/URL>/.exec(t)?.[1] ?? "").trim(),
      name: (/<Name>([\s\S]*?)<\/Name>/.exec(t.replace(/<VariableLength>[\s\S]*$/, ""))?.[1] ?? "").trim(),
      description: (/<Description>([\s\S]*?)<\/Description>/.exec(t)?.[1] ?? "").trim(),
      from: Number(/<Range>\s*<From>(\d+)<\/From>/.exec(t)?.[1] ?? 1),
      sep: sepRaw === "&#9;" ? "\t" : entities(sepRaw) || "\t",
      columns,
    };
  });
}

function fromGdpdu(files: Map<string, () => Buffer>): Table[] {
  const byBase = new Map([...files.entries()].map(([n, f]) => [n.split("/").pop()!.toLowerCase(), f]));
  const index = byBase.get("index.xml");
  if (!index) throw new ErpImportError("Im ZIP fehlt die index.xml.");
  const defs = gdpduIndex(decodeText(index()));
  const read = (d: GdpduTable) => {
    const f = byBase.get(d.url.split(/[\\/]/).pop()!.toLowerCase());
    if (!f) return [];
    const lines = decodeText(f()).split(/\r?\n/).slice(Math.max(0, d.from - 1)).filter((l) => l.trim() !== "");
    return lines.map((l) => Object.fromEntries(l.split(d.sep).map((v, i) => [d.columns[i] ?? `Spalte ${i + 1}`, entities(v).trim()]).filter(([, v]) => v !== "")) as Record<string, string>);
  };
  const isHead = (d: GdpduTable) => /verkauf_bp$/i.test(d.name) || /^belege im verkauf/i.test(d.description);
  const isPos = (d: GdpduTable) => /positionen_vk/i.test(d.name) || /belegpositionen verkauf/i.test(d.description);
  const heads = defs.filter(isHead).flatMap(read);
  if (!heads.length) {
    // Unbekannter GDPdU-Export: alle Tabellen so übernehmen, wie sie sind
    const tables = defs.map((d) => ({ name: d.description || d.name, rows: read(d) })).filter((t) => t.rows.length);
    if (!tables.length) throw new ErpImportError("Der Betriebsprüfungs-Export enthält keine Daten.");
    return tables;
  }
  const key = (typ: string, nr: string) => `${typ.toLowerCase()}|${nr}`;
  const positions = new Map<string, Record<string, unknown>[]>();
  for (const p of defs.filter(isPos).flatMap(read)) {
    const k = key(p.Belegtyp ?? "", p.Belegnummer ?? "");
    const list = positions.get(k) ?? [];
    list.push({ Bezeichnung: p.Bezeichnung ?? "", Einheit: p.Einheit ?? "", Menge: p.Menge ?? "", Rabatt: p.Rabatt_Prozent_Position ?? "", Netto: p.Positionspreis_netto ?? "", USt: p.Ust_Betrag ?? "", Satz: p.Ust_Satz_Prozent ?? "" });
    positions.set(k, list);
  }
  const eur = (n: number) => n.toFixed(2).replace(".", ",");
  const docs: Record<string, unknown>[] = [];
  const other: Record<string, unknown>[] = [];
  for (const h of heads) {
    const typ = h.Belegtyp ?? "";
    const pos = positions.get(key(typ, h.Belegnummer ?? "")) ?? [];
    const net = parseAmount(h["Belegsumme-netto"]) ?? 0;
    const tax = parseAmount(h.Beleg_Ust_Betrag) ?? 0;
    const zahl = (h.Zahlstatus ?? "").toLowerCase();
    const storno = /storno|gutschrift/i.test(typ);
    const first = String(pos[0]?.Bezeichnung ?? "").replace(/^[-–\s]+/, "").replace(/\s+/g, " ").slice(0, 120);
    const row: Record<string, unknown> = {
      Vorgangsart: typ,
      // Nummern sind je Belegart eigene Kreise (Rechnung 1 ≠ Rechnungskorrektur 1)
      Belegnummer: /korrektur/i.test(typ) ? `RK-${h.Belegnummer}` : h.Belegnummer,
      Belegdatum: h.Belegdatum,
      Kunde: h.Kundenname,
      Kundennummer: h.Kundennummer,
      Betreff: first || undefined,
      Status: storno ? "Storno" : /teil/.test(zahl) ? "teilbezahlt" : /nicht|unbezahlt|offen/.test(zahl) ? "offen" : /bezahlt/.test(zahl) ? "bezahlt" : zahl || undefined,
      "Betrag netto": eur(net),
      USt: eur(tax),
      "Betrag brutto": eur(net + tax),
      Zahldatum: h.Zahldatum,
      Zahlbetrag: h.Zahlbetrag,
      Leistungsdatum: h.Leistungsdatum || h.Lieferdatum,
      Strasse: h.Adresszeile2 || h.Adresszeile1,
      PLZ: h.Postleitzahl,
      Ort: h.Ort,
      Land: h.Land,
      "USt-IdNr.": h["USt.-Ident.-Nr."],
      "§ 13b": h["USt. Paragraph 13b"] === "ja" || h["EG USt. Paragraph 13b"] === "ja" ? "ja" : undefined,
      "Weitergeführt aus": h["Weitergefuehrt aus"],
      Positionen: pos.length ? pos : undefined,
    };
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== ""));
    (/rechnung|storno|gutschrift|korrektur/i.test(typ) ? docs : other).push(clean);
  }
  const tables: Table[] = [];
  if (docs.length) tables.push({ name: "Lexware Verkauf · Rechnungen und Stornos", rows: docs, kind: "rechnung" });
  if (other.length) tables.push({ name: "Lexware Verkauf · Lieferscheine und Sonstiges", rows: other, kind: "sonstiges" });
  return tables;
}

export function parseExport(fileName: string, buf: Buffer): { format: string; tables: Table[] } {
  const lower = fileName.toLowerCase();
  if (buf.subarray(0, 2).toString() === "PK" && !lower.endsWith(".xlsx")) {
    const files = unzip(buf);
    if ([...files.keys()].some((n) => /(^|\/)index\.xml$/i.test(n))) return { format: "gdpdu", tables: fromGdpdu(files) };
  }
  if (buf.subarray(0, 2).toString() === "PK" || lower.endsWith(".xlsx")) return { format: "xlsx", tables: fromXlsx(buf) };
  if (lower.endsWith(".xls")) throw new ErpImportError("Altes Excel-Format (.xls) – bitte als .xlsx oder CSV speichern.");
  const head = buf.subarray(0, 200).toString("utf8").replace(/^﻿/, "").trimStart();
  if (lower.endsWith(".json") || head.startsWith("{") || head.startsWith("[")) return { format: "json", tables: fromJson(fileName.replace(/\.[^.]+$/, ""), buf) };
  return { format: "csv", tables: fromCsv(fileName.replace(/\.[^.]+$/, ""), buf) };
}

// ---------- Erkennen ----------

// Je Feld eine oder mehrere Regeln in Vorrang-Reihenfolge (z. B. „Firma“ vor „Name“). Spaltennamen aus
// Lexware faktura+auftrag (Kunden-/Artikel-/Vorgangsexport) sind mit drin.
type Rule = RegExp | RegExp[];
const FIELDS: Record<Exclude<ErpKind, "sonstiges">, Record<string, Rule>> = {
  kunde: {
    nummer: /^(kundennr|kundennummer|kdnr|kundenid|debitorennr|debitor|debitorennummer|adressnr|adressnummer|nr|nummer|id|customerid|customernumber|number)$/,
    name: [/^(firma|firmenname|firma1|company|companyname|unternehmen|name1)$/, /^(name|kunde|kundenname|customer|customername|bezeichnung|anzeigename|suchname)$/],
    anrede: /^(anrede|salutation|briefanrede)$/,
    vorname: /^(vorname|firstname)$/,
    // Lexware faktura+auftrag: „Name“ = Nachname, „Firma“ separat – Name geht vor Ansprechpartner
    nachname: [/^(nachname|lastname|name2)$/, /^name$/, /^(ansprechpartner|kontakt|kontaktperson|contact|contactperson|firma2)$/],
    ansprechpartner: /^(ansprechpartner|kontakt|kontaktperson|contact|contactperson)$/,
    email: /^(email|mail|emailadresse|emailaddress|email1|emailgeschaeftlich)$/,
    telefon: /^(telefon|tel|phone|telefonnummer|mobil|handy|mobile|telefon1|telefonnummer1|telefongeschaeftlich|mobiltelefon)$/,
    strasse: /^(strasse|str|adresse|anschrift|street|address|strassehausnummer|strassehausnr|strasse1|adressestrasse|addressstreet|rechnungsadressestrasse)$/,
    plz: /^(plz|postleitzahl|zip|zipcode|postalcode|adresseplz|addresszip|plz1|rechnungsadresseplz)$/,
    ort: /^(ort|stadt|city|wohnort|adresseort|addresscity|ort1|rechnungsadresseort)$/,
    notiz: /^(notiz|notizen|bemerkung|bemerkungen|note|notes|info|hinweis|memo)$/,
  },
  artikel: {
    nummer: /^(artikelnr|artikelnummer|artnr|nr|nummer|id|sku|positionsnr|leistungsnr|matchcode)$/,
    name: /^(bezeichnung|bezeichnung1|artikel|artikelbezeichnung|kurzbezeichnung|name|titel|title|leistung|produkt|kurztext|position)$/,
    beschreibung: /^(beschreibung|langtext|description|details|text|bezeichnung2|artikeltext)$/,
    einheit: /^(einheit|me|mengeneinheit|unit|unitname|verkaufseinheit)$/,
    preis: [/^(vkpreis|verkaufspreis|vk|vknetto|vkpreisnetto|verkaufspreisnetto|preisvk|vkpreisnettoeur)\d?$/, /^(preis|nettopreis|einzelpreis|ep|price|netprice|stundensatz|listenpreis|preisnetto)\d?(netto|eur|euro|ineur)?$/],
    ust: /^(ust|mwst|steuersatz|ustsatz|mwstsatz|tax|taxrate|steuer|steuersatzin|ustin|mwstin|umsatzsteuer)$/,
  },
  rechnung: {
    nummer: [/^(rechnungsnr|rechnungsnummer|renr|rgnr|invoicenumber|invoiceno)$/, /^(vorgangsnr|vorgangsnummer|belegnr|belegnummer|dokumentnr|dokumentnummer|auftragsnr|auftragsnummer|nr|nummer|id|number)$/],
    kunde: /^(kunde|kundenname|firma|empfaenger|name|name1|customer|customername|auftraggeber|kundefirma|kundename|rechnungsempfaenger)$/,
    kundennr: /^(kundennr|kundennummer|kdnr|debitor|debitorennr)$/,
    datum: /^(datum|rechnungsdatum|belegdatum|vorgangsdatum|auftragsdatum|date|erstellt|erstelltam|createdat|invoicedate)$/,
    faellig: /^(faellig|faelligam|faelligkeit|zahlungsziel|duedate|faelligkeitsdatum|faelligbis)$/,
    brutto: /^(brutto|betrag|summe|gesamt|gesamtbetrag|bruttobetrag|bruttosumme|endbetrag|endsumme|total|amount|betragbrutto|summebrutto|gesamtbrutto|gesamtsummebrutto|totalgross|rechnungsbetrag)$/,
    netto: /^(netto|nettobetrag|nettosumme|summenetto|betragnetto|gesamtnetto|subtotal|totalnet)$/,
    offen: /^(offen|offenerbetrag|offenbetrag|restbetrag|rest|offeneposten|nochoffen)$/,
    status: /^(status|zustand|bezahlt|zahlstatus|zahlungsstatus|erledigt|ausgeglichen|paid)$/,
    titel: /^(titel|betreff|bezeichnung|title|subject|projekt|bauvorhaben|leistung|bemerkung)$/,
  },
  angebot: {
    nummer: [/^(angebotsnr|angebotsnummer|angnr|quotenumber)$/, /^(vorgangsnr|vorgangsnummer|belegnr|belegnummer|dokumentnr|dokumentnummer|nr|nummer|id|number)$/],
    kunde: /^(kunde|kundenname|firma|empfaenger|name|name1|customer|customername|auftraggeber|kundefirma|kundename)$/,
    kundennr: /^(kundennr|kundennummer|kdnr|debitor|debitorennr)$/,
    datum: /^(datum|angebotsdatum|belegdatum|vorgangsdatum|date|erstellt|erstelltam|createdat)$/,
    faellig: /^(gueltigbis|gueltig|bindefrist|validuntil|ablauf)$/,
    brutto: /^(brutto|betrag|summe|gesamt|gesamtbetrag|bruttobetrag|bruttosumme|endbetrag|endsumme|total|amount|betragbrutto|summebrutto|gesamtsummebrutto|angebotssumme)$/,
    netto: /^(netto|nettobetrag|nettosumme|summenetto|betragnetto|gesamtnetto|subtotal)$/,
    status: /^(status|zustand|angenommen|erledigt)$/,
    titel: /^(titel|betreff|bezeichnung|title|subject|projekt|bauvorhaben|leistung|bemerkung)$/,
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
  rechnung: /^(rechnungsnr|rechnungsnummer|renr|rgnr|rechnungsdatum|invoicenumber|rechnungsbetrag|offenerbetrag|restbetrag)$/,
  angebot: /^(angebotsnr|angebotsnummer|angebotsdatum|gueltigbis|bindefrist|angebotssumme|quotenumber)$/,
  artikel: /^(artikelnr|artikelnummer|artnr|einheit|mengeneinheit|vkpreis|vkpreis1|verkaufspreis|einzelpreis|sku)$/,
  kunde: /^(kundennr|kundennummer|plz|postleitzahl|email|telefon|ansprechpartner)$/,
  projekt: /^(projektnr|projektnummer|baustelle|bauherr|beginn|fertigstellung)$/,
};
const NAME_HINT: Partial<Record<ErpKind, RegExp>> = {
  kunde: /kunde|customer|client|kontakt|debitor|adress/i,
  artikel: /artikel|leistung|product|produkt|item|material|preisliste/i,
  rechnung: /rechnung|invoice|faktur/i,
  angebot: /angebot|quote|offer|kostenvoranschlag/i,
  projekt: /projekt|project|auftr|baustelle/i,
};

export function mapColumns(kind: ErpKind, headers: string[]) {
  const mapping: Record<string, string> = {};
  // Sonstiges (z. B. Gutschriften, Lieferscheine): Nummer, Kunde, Datum, Betrag wie bei Rechnungen erkennen – nur fürs Archiv
  const fields = FIELDS[kind === "sonstiges" ? "rechnung" : kind];
  const used = new Set<string>();
  for (const [field, rule] of Object.entries(fields)) {
    for (const re of Array.isArray(rule) ? rule : [rule]) {
      const h = headers.find((x) => !used.has(x) && re.test(norm(x)));
      if (h) {
        (mapping[field] = h), used.add(h);
        break;
      }
    }
  }
  return mapping;
}

// Positionslisten (eine Zeile je Belegposition) sind keine Artikel – sonst würde „Artikel übernehmen“ jede Position anlegen
const DOC_REF = /^(vorgangsnr|vorgangsnummer|belegnr|belegnummer|rechnungsnr|rechnungsnummer|auftragsnr|auftragsnummer|angebotsnr|angebotsnummer|dokumentnr)$/;
const POS_COL = /^(pos|posnr|position|positionsnr|positionsnummer|menge|anzahl)$/;

export function detectKind(tableName: string, headers: string[]): ErpKind {
  const n = headers.map(norm);
  if ((/position/i.test(tableName) || n.some((h) => POS_COL.test(h))) && n.some((h) => DOC_REF.test(h)) && n.some((h) => /artikel|einzelpreis|^menge$/.test(h))) return "sonstiges";
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

// Gemischte Vorgangsliste (z. B. Lexware faktura+auftrag: Angebote, Aufträge, Lieferscheine, Rechnungen, Gutschriften
// in einer Datei) → je Vorgangsart eine eigene Tabelle
const TYPE_COL = /^(vorgangsart|vorgangstyp|belegart|belegtyp|auftragsart|dokumentart|dokumenttyp|art|typ|vorgang|beleg)$/;
const VORGANG: [RegExp, string, ErpKind][] = [
  [/gutschrift|storno|korrektur/i, "Gutschriften", "sonstiges"],
  [/angebot|kostenvoranschlag|^kva$/i, "Angebote", "angebot"],
  [/auftragsbest|^ab$/i, "Auftragsbestätigungen", "sonstiges"],
  [/lieferschein|^ls$/i, "Lieferscheine", "sonstiges"],
  [/rechnung|faktura|^re$|^rg$/i, "Rechnungen", "rechnung"],
  [/auftrag/i, "Aufträge", "sonstiges"],
  [/bestellung|anfrage|proforma/i, "Sonstige Vorgänge", "sonstiges"],
];
export function vorgangsart(v: unknown) {
  const s = (v === null || v === undefined ? "" : String(v)).trim();
  return s ? VORGANG.find(([re]) => re.test(s)) : undefined;
}

// Lexware faktura+auftrag „Buchungsdaten“ (Export für die Fibu): eine Zeile je Steuersatz, Kunde und Belegart nur im
// Buchungstext („RG202638 USt.19.00% Midas … mbH“). → eine Zeile je Beleg mit Kunde, Art und Summe. Ob bezahlt ist, steht
// dort nicht drin („Zahlung unbekannt“ zählt nicht als offen).
const BOOKING_TEXT = /^([A-Za-zÄÖÜ]{1,4})[-\s]?(\d\S*)\s+(?:((?:USt|MwSt|VSt)\.?\s*(\d[\d.,]*)\s*%)\s*)?(.*)$/i;
export function lexwareBookings(t: Table): Table {
  const headers = new Set(t.rows.flatMap((r) => Object.keys(r)).map(norm));
  if (!headers.has("buchungstext") || !(headers.has("buchungsbetrag") || headers.has("buchungsbetrageuro")) || !(headers.has("sollkonto") || headers.has("habenkonto"))) return t;
  const get = (r: Record<string, unknown>, n: string) => {
    const k = Object.keys(r).find((x) => norm(x) === n);
    return k === undefined ? "" : String(r[k] ?? "").trim();
  };
  // Je Beleg: Erlöszeile (netto, „RG202638 Midas …“) + Steuerzeile („RG202638 USt.19.00% Midas …“) → netto, USt, brutto
  const docs = new Map<string, { row: Record<string, unknown>; net: number; tax: number; rates: Set<string>; texts: string[] }>();
  const eur = (n: number) => n.toFixed(2).replace(".", ",");
  for (const r of t.rows) {
    const text = get(r, "buchungstext");
    const m = BOOKING_TEXT.exec(text);
    const nr = get(r, "belegnummer") || m?.[2] || text;
    const amount = parseAmount(get(r, "buchungsbetrageuro") || get(r, "buchungsbetrag")) ?? 0;
    const prefix = (m?.[1] ?? "").toUpperCase();
    const art = /^(GS|G|GU|ST)$/.test(prefix) || /gutschrift|storno/i.test(text) ? "Gutschrift" : "Rechnung";
    const key = `${art}|${nr}`;
    const d = docs.get(key) ?? { row: { Belegnummer: nr, Belegdatum: get(r, "belegdatum"), Vorgangsart: art, Status: "Zahlung unbekannt" }, net: 0, tax: 0, rates: new Set<string>(), texts: [] };
    if (m?.[3]) {
      d.tax += amount;
      d.rates.add(`${m[4].replace(/\.?0+$/, "").replace(".", ",")} %`);
    } else d.net += amount;
    const kunde = m?.[5]?.trim();
    if (kunde && !d.row.Kunde) d.row.Kunde = kunde;
    if (d.texts.length < 4) d.texts.push(text);
    docs.set(key, d);
  }
  const rows = [...docs.values()].map((d) =>
    Object.fromEntries(
      Object.entries({ ...d.row, "Betrag netto": eur(d.net), USt: eur(d.tax), "Betrag brutto": eur(d.net + d.tax), Steuersatz: [...d.rates].join(", ") || (d.tax ? "" : "ohne USt (z. B. § 13b)"), Buchungstext: d.texts.join(" | ") }).filter(([, v]) => v !== "" && v !== undefined),
    ),
  );
  return { name: t.name, rows };
}

/** Umsatz netto aus dem Archiv (alte Rechnungen aus Lexware usw.) – doppelt hochgeladene Belege zählen einmal */
export async function archiveRevenue(from: string, to: string) {
  // In die Buchhaltung übernommene (lexId) zählen dort als Rechnung – hier nicht doppelt
  const recs = await db.erpRecord.findMany({ where: { kind: "rechnung", lexId: null, date: { gte: berlinDateTime(from, "00:00"), lte: berlinDateTime(to, "23:59") } }, select: { number: true, date: true, amount: true, fields: true } });
  const seen = new Set<string>();
  let cents = 0;
  let count = 0;
  for (const r of recs) {
    const key = r.number ? `${r.number}|${r.date?.toISOString().slice(0, 10)}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const net = parseAmount((r.fields as Record<string, string> | null)?.netto) ?? r.amount;
    if (net === null) continue;
    cents += Math.round(net * 100);
    count++;
  }
  return { netCents: cents, count };
}

export function splitByType(t: Table): Table[] {
  if (t.kind) return [t];
  const headers = [...new Set(t.rows.flatMap((r) => Object.keys(r)))];
  for (const h of headers.filter((x) => TYPE_COL.test(norm(x)))) {
    const vals = t.rows.map((r) => r[h]).filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (vals.length < Math.max(1, t.rows.length * 0.8)) continue;
    const known = vals.filter((v) => vorgangsart(v)).length;
    if (known < vals.length * 0.8) continue;
    const groups = new Map<string, Table>();
    for (const r of t.rows) {
      const m = vorgangsart(r[h]);
      const label = m?.[1] ?? "Sonstige Vorgänge";
      const g = groups.get(label) ?? { name: `${t.name} · ${label}`.slice(0, 120), rows: [], kind: m?.[2] ?? "sonstiges" };
      g.rows.push(r);
      groups.set(label, g);
    }
    if (groups.size < 2 && !groups.has("Rechnungen") && !groups.has("Angebote")) return [t];
    return [...groups.values()];
  }
  return [t];
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

/** Status vereinheitlichen: „Bezahlt: ja/nein“ bzw. offener Betrag → „bezahlt“/„offen“ (sonst zählt die Suche „ja“ als offen) */
export function statusOf(kind: ErpKind, f: Record<string, string>, statusHeader?: string) {
  let s = f.status?.trim() || "";
  if (kind === "rechnung" && statusHeader && /^(bezahlt|paid|erledigt|ausgeglichen)$/.test(norm(statusHeader))) {
    if (/^(ja|j|yes|x|1|true|wahr)$/i.test(s)) s = "bezahlt";
    else if (/^(nein|n|no|0|false|falsch)$/i.test(s)) s = "offen";
  }
  if (kind === "rechnung" && f.offen !== undefined && (!s || /^(ja|nein)$/i.test(s))) {
    const o = parseAmount(f.offen);
    if (o !== null) s = Math.abs(o) < 0.005 ? "bezahlt" : "offen";
  }
  return s.slice(0, 60) || null;
}

function recordFrom(kind: ErpKind, mapping: Record<string, string>, row: Record<string, unknown>) {
  const f = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, str(row[h]).slice(0, 2000)]).filter(([, v]) => v)) as Record<string, string>;
  const person = [f.vorname, f.nachname].filter(Boolean).join(" ");
  const name = (kind === "kunde" ? f.name || person : kind === "rechnung" || kind === "angebot" || kind === "sonstiges" ? f.titel : f.name) || null;
  const amount = kind === "artikel" ? parseAmount(f.preis) : kind === "rechnung" || kind === "angebot" || kind === "sonstiges" ? (parseAmount(f.brutto) ?? parseAmount(f.netto)) : null;
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
    status: statusOf(kind, f, mapping.status),
    fields: f,
    raw: JSON.parse(JSON.stringify(row)) as object,
    search,
  };
}

// ---------- Import ----------

export async function importExport(opts: { fileName: string; data: Buffer; userName: string }) {
  const parsed = parseExport(opts.fileName, opts.data);
  const format = parsed.format;
  const tables = parsed.tables.map(lexwareBookings).flatMap(splitByType);
  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  if (total > MAX_ROWS) throw new ErpImportError(`Zu viele Zeilen (${total.toLocaleString("de-DE")}) – höchstens ${MAX_ROWS.toLocaleString("de-DE")} je Datei. Bitte aufteilen.`);
  const infos: TableInfo[] = tables.map((t) => {
    const headers = [...new Set(t.rows.flatMap((r) => Object.keys(r)))].slice(0, 200);
    const kind = t.kind ?? detectKind(t.name, headers);
    return { name: t.name.slice(0, 120), kind, headers, mapping: mapColumns(kind, headers), rows: t.rows.length };
  });
  const imp = await db.erpImport.create({ data: { fileName: opts.fileName.slice(0, 200), format, tables: infos as object[], rows: total, userName: opts.userName } });
  for (let t = 0; t < tables.length; t++) {
    const info = infos[t];
    const recs = tables[t].rows.map((r) => ({ importId: imp.id, table: info.name, ...recordFrom(info.kind, info.mapping, r) }));
    for (let i = 0; i < recs.length; i += 1000) await db.erpRecord.createMany({ data: recs.slice(i, i + 1000) });
  }
  // Beleg-PDFs, die vor dieser Liste hochgeladen wurden, jetzt dem passenden Datensatz zuordnen
  await relinkPdfs(imp.id);
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
export async function claim(importId: string, what: "kunde" | "artikel" | "projekt" | "rechnung") {
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
        let anrede = f.anrede && !/^(firma|eheleute|familie)$/i.test(f.anrede.trim()) ? f.anrede : undefined;
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
          contactName: firma && (f.ansprechpartner || vorname || nachname) ? (f.ansprechpartner || [vorname, nachname].filter(Boolean).join(" ")).slice(0, 150) : undefined,
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

/** Tage, ab denen eine alte Rechnung ohne bekannten Zahlstatus als bezahlt gilt */
export const ASSUME_PAID_DAYS = 30;

/** Positionen aus dem Betriebsprüfungs-Export → Belegpositionen (Positionspreis ist die Zeilensumme netto) */
function linesFromPositions(raw: unknown, reverseCharge: boolean) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: Record<string, unknown>) => {
    const text = String(p.Bezeichnung ?? "").replace(/\s+\n/g, "\n").trim();
    const total = parseAmount(p.Netto);
    if (!text && !total) return [];
    const qtyRaw = parseAmount(p.Menge);
    const qty = qtyRaw && Math.abs(qtyRaw) > 0 ? Math.abs(qtyRaw) : 1;
    const net = Math.abs(total ?? 0);
    const rate = Math.round(parseAmount(p.Satz) ?? 19);
    const name = (text || "Position").split("\n")[0].slice(0, 300);
    const rest = text.length > name.length ? text.slice(name.length).trim() : "";
    return [{
      articleId: null,
      name,
      description: rest ? rest.slice(0, 4000) : null,
      qty,
      unit: (String(p.Einheit ?? "").trim() || (qty === 1 ? "psch" : "Stk")).slice(0, 30),
      price: Math.round((net / qty) * 10000) / 10000,
      discount: 0,
      taxRate: (reverseCharge ? 0 : rate === 7 ? 7 : rate === 0 ? 0 : 19) as 19 | 7 | 0,
    }];
  });
}

/**
 * Alte Rechnungen als übernommene Belege in die Buchhaltung (`imported`, `finalizedBy` „Lexware“, Nummer bleibt):
 * dann zählen sie überall mit – Umsatz, Jahresauswertung, Kundenakte, Rechnungslisten, offene Posten.
 * Mit Positionen (Betriebsprüfungs-Export) werden diese übernommen, sonst eine Sammelposition je Beleg; Beträge immer exakt
 * aus netto/USt des Belegkopfs. Stornos werden Gutschriften und die stornierte Rechnung wird „storniert“.
 * Zahlstatus: bezahlt/teilbezahlt/offen aus der Liste (mit Zahldatum/-betrag); unbekannt → älter als 30 Tage bezahlt, sonst offen.
 * Fehlt der Kunde in der Buchhaltung, wird er mit der Anschrift und Kd-Nr. aus Lexware angelegt.
 */
export async function transferInvoices(importId: string, userName: string) {
  const stats = { created: 0, linked: 0, open: 0, credits: 0, customers: 0 };
  try {
    const all = await db.erpRecord.findMany({ where: { importId, kind: "rechnung", lexId: null }, orderBy: { date: "asc" } });
    const isStorno = (r: (typeof all)[number]) => /storno|gutschrift/i.test(String((r.raw as Record<string, unknown>).Vorgangsart ?? "")) || /^storno$/i.test(r.status ?? "");
    // Erst die Rechnungen, dann die Stornos (die verweisen auf ihre Rechnung)
    const recs = [...all.filter((r) => !isStorno(r)), ...all.filter(isStorno)];
    const today = Date.now();
    for (const r of recs) {
      try {
        const f = r.fields as Record<string, string>;
        const raw = r.raw as Record<string, unknown>;
        const storno = isStorno(r);
        const kind = storno ? "GUTSCHRIFT" : "RECHNUNG";
        if (!r.number) throw new Error("Belegnummer fehlt.");
        if (!r.date) throw new Error("Belegdatum fehlt.");
        const gross = r.amount;
        if (gross === null) throw new Error("Betrag fehlt.");
        const net = parseAmount(f.netto) ?? gross;
        // Gutschriften werden wie in Jarvis mit positiven Beträgen gespeichert
        const grossCents = Math.round((storno ? Math.abs(gross) : gross) * 100);
        const netCents = Math.round((storno ? Math.abs(net) : net) * 100);
        const taxCents = grossCents - netCents;
        const reverseCharge = taxCents === 0 && (String(raw["§ 13b"] ?? "") === "ja" || /13b|ohne ust/i.test(String(raw.Steuersatz ?? "")));
        const posLines = linesFromPositions(raw.Positionen, reverseCharge);
        const same = await db.salesDoc.findFirst({ where: { kind, number: r.number }, select: { id: true, imported: true, lines: true, netCents: true } });
        if (same?.imported) {
          // Schon übernommen (z. B. aus den Buchungsdaten mit Sammelposition) → Positionen nachtragen, wenn die Summe passt
          const old = readLines(same.lines);
          if (posLines.length && old.length <= 1 && Math.abs(same.netCents - netCents) <= 1) await db.salesDoc.update({ where: { id: same.id }, data: { lines: posLines as object[] } });
          await db.erpRecord.update({ where: { id: r.id }, data: { lexId: same.id, error: null } });
          stats.linked++;
          continue;
        }
        const number = same ? `${r.number} (Lexware)` : r.number;
        // Kunde: Kd-Nr. aus Lexware, gleicher Name, Kunden-Import – sonst neu mit der Anschrift aus dem Beleg
        const kdnr = /^\d{1,9}$/.test(f.kundennr ?? "") ? Number(f.kundennr) : null;
        let customer = kdnr ? await db.customer.findUnique({ where: { number: kdnr } }) : null;
        if (customer && r.party && customer.name.toLowerCase().slice(0, 4) !== r.party.toLowerCase().slice(0, 4)) customer = null;
        if (!customer && r.party) customer = await db.customer.findFirst({ where: { name: { equals: r.party, mode: "insensitive" } } });
        if (!customer && f.kundennr) {
          const k = await db.erpRecord.findFirst({ where: { kind: "kunde", number: f.kundennr, lexId: { not: null } }, select: { lexId: true } });
          if (k?.lexId && !k.lexId.includes("-")) customer = await db.customer.findUnique({ where: { id: k.lexId } });
        }
        if (!customer && r.party && raw.Ort) {
          const country = String(raw.Land ?? "DE").trim();
          customer = await createCustomer(
            customerInput.parse({ kind: "FIRMA", company: r.party.slice(0, 150), street: String(raw.Strasse ?? "").slice(0, 150) || null, zip: String(raw.PLZ ?? "").slice(0, 10) || null, city: String(raw.Ort ?? "").slice(0, 80) || null, country: /^[A-Z]{2}$/i.test(country) ? country : "DE", vatId: String(raw["USt-IdNr."] ?? "") || null, notes: "Aus Lexware-Belegen angelegt (Datenübernahme)." }),
            { number: kdnr, lexId: null },
          );
          stats.customers++;
        }
        const rate = netCents ? Math.round((taxCents / netCents) * 100) : 0;
        const taxRate = (Math.abs(rate - 19) <= 1 ? 19 : Math.abs(rate - 7) <= 1 ? 7 : rate === 0 ? 0 : 19) as 19 | 7 | 0;
        const st = (r.status ?? "").toLowerCase();
        const known = !storno && /bezahlt|paid|ausgeglichen|erledigt|offen|open|teil/.test(st);
        const partial = /teil/.test(st);
        const status = storno ? "OFFEN" : partial || /nicht|unbezahlt|offen|open/.test(st) ? "OFFEN" : /bezahlt|paid|ausgeglichen|erledigt/.test(st) ? "BEZAHLT" : today - r.date.getTime() > ASSUME_PAID_DAYS * 86_400_000 ? "BEZAHLT" : "OFFEN";
        const payDay = parseDate(raw.Zahldatum) ?? r.date;
        const paidCents = storno ? 0 : status === "BEZAHLT" ? grossCents : partial ? Math.min(grossCents, Math.round((parseAmount(raw.Zahlbetrag) ?? 0) * 100)) : 0;
        const service = parseDate(raw.Leistungsdatum);
        // Storno: zugehörige Rechnung („RG202462“) finden
        const srcNo = storno ? String(raw["Weitergeführt aus"] ?? "").replace(/^[A-Za-z]{1,3}[-\s]?/, "") : "";
        const source = srcNo ? await db.salesDoc.findFirst({ where: { kind: "RECHNUNG", number: srcNo, imported: true } }) : null;
        const pdf = r.fileId ? (await db.storedFile.findUnique({ where: { id: r.fileId }, select: { data: true } }))?.data ?? null : null;
        const lines = posLines.length
          ? posLines
          : [{ articleId: null, name: (r.name || `Leistung lt. ${storno ? "Storno" : "Rechnung"} ${r.number}`).slice(0, 300), description: "Aus Lexware übernommen – Positionen siehe Original-Beleg.", qty: 1, unit: "psch", price: netCents / 100, discount: 0, taxRate: reverseCharge ? 0 : taxRate }];
        const doc = await db.$transaction(async (tx) => {
          const d = await tx.salesDoc.create({
            data: {
              kind,
              status,
              number,
              customerId: customer?.id ?? null,
              address: { name: customer?.name ?? r.party ?? "", street: customer?.street ?? (raw.Strasse as string) ?? null, zip: customer?.zip ?? (raw.PLZ as string) ?? null, city: customer?.city ?? (raw.Ort as string) ?? null, country: customer?.country ?? "DE", email: customer?.email ?? null, vatId: customer?.vatId ?? (raw["USt-IdNr."] as string) ?? null, customerNo: customer?.number ?? null } as object,
              title: (storno && source ? `Storno zu Rechnung ${source.number}` : r.name)?.slice(0, 200) ?? null,
              date: r.date!,
              serviceFrom: service,
              serviceTo: service,
              dueDate: r.dueDate,
              reverseCharge,
              lines: lines as object[],
              netCents,
              taxCents,
              grossCents,
              paidCents,
              sourceId: source?.id ?? null,
              finalizedAt: r.date,
              finalizedBy: "Lexware",
              pdf: pdf ? new Uint8Array(pdf) : null,
              imported: true,
              createdBy: userName,
            },
          });
          if (paidCents > 0)
            await tx.payment.create({ data: { docId: d.id, day: payDay, amountCents: paidCents, note: known ? `Zahlung aus Lexware übernommen${partial ? " (teilbezahlt)" : ""}` : `Zahlstatus aus Lexware unbekannt – älter als ${ASSUME_PAID_DAYS} Tage, als bezahlt angenommen`, userName } });
          if (source) {
            await tx.salesDoc.updateMany({ where: { id: source.id, status: { in: ["OFFEN", "BEZAHLT"] } }, data: { status: "STORNIERT" } });
            await tx.salesDocEvent.create({ data: { docId: source.id, text: `In Lexware storniert (Storno ${r.number})`, userName } });
          }
          await tx.salesDocEvent.create({ data: { docId: d.id, text: `Aus Lexware übernommen (Datenübernahme, Archiv-Datensatz ${r.id})${!storno && !known ? ` – Zahlstatus unbekannt, ${status === "BEZAHLT" ? "als bezahlt angenommen" : "offen gelassen"}` : ""}`, userName } });
          await tx.erpRecord.update({ where: { id: r.id }, data: { lexId: d.id, error: null } });
          return d;
        });
        stats.created++;
        if (storno) stats.credits++;
        else if (doc.status === "OFFEN") stats.open++;
      } catch (e) {
        await db.erpRecord.update({ where: { id: r.id }, data: { error: errText(e) } });
      }
    }
  } finally {
    await release(importId);
  }
  return stats;
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

// ---------- Beleg-PDFs aus dem alten Programm ----------
// Die alten Belege (GoBD: 10 Jahre aufbewahren) als PDF hochladen. Steht die Belegnummer im Dateinamen, hängt das PDF am
// passenden Datensatz aus der Liste. Ohne Treffer bleibt es als eigener Archiv-Eintrag (Platzhalter) im PDF-Import und wird
// zugeordnet, sobald die passende Liste hochgeladen wird.

const DOC_KINDS = ["rechnung", "angebot", "sonstiges"];

/** Belegnummern im Dateinamen: „Rechnung RE-1023 Müller.pdf“ → ["RE-1023", "1023"] */
export function numberCandidates(fileName: string) {
  const out = new Set<string>();
  for (const tok of fileName.replace(/\.[a-z0-9]{2,4}$/i, "").split(/[\s_,;()[\]]+/)) {
    const t = tok.replace(/^[-.#:]+|[-.#:]+$/g, "");
    if (!/\d/.test(t) || t.length > 40) continue;
    out.add(t);
    const m = /^(?:nr|re|rg|an|ag|ab|ls|gs|kva|[a-zäöü]{1,4})[-.:#]{0,2}(\d[\d\-/.]*)$/i.exec(t);
    if (m) out.add(m[1]);
    for (const x of [...out]) if (/^0+\d/.test(x)) out.add(x.replace(/^0+(?=\d)/, ""));
  }
  return [...out].slice(0, 20);
}

const kindHint = (fileName: string): ErpKind | null => (/angebot|kostenvoranschlag/i.test(fileName) ? "angebot" : /gutschrift|storno/i.test(fileName) ? "sonstiges" : /rechnung|faktura/i.test(fileName) ? "rechnung" : null);

/** Bester Datensatz zu einem Dateinamen (Art aus dem Dateinamen bevorzugt, dann Rechnung vor Angebot) */
function pick<T extends { kind: string; number: string | null }>(fileName: string, recs: T[]) {
  const hint = kindHint(fileName);
  const cands = numberCandidates(fileName);
  const score = (r: T) => (r.kind === hint ? 100 : 0) + (r.kind === "rechnung" ? 20 : r.kind === "angebot" ? 10 : 0) + (cands.indexOf(r.number ?? "") === 0 ? 5 : 0);
  return [...recs].sort((a, b) => score(b) - score(a))[0];
}

export async function attachPdf(opts: { importId?: string | null; fileName: string; data: Buffer; userName: string }) {
  if (opts.data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ErpImportError("Nur PDF-Dateien.");
  let imp = opts.importId ? await db.erpImport.findFirst({ where: { id: opts.importId, format: "pdf" }, select: { id: true } }) : null;
  imp ??= await db.erpImport.create({ data: { fileName: `Beleg-PDFs vom ${new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`, format: "pdf", tables: [], rows: 0, userName: opts.userName }, select: { id: true } });
  const name = opts.fileName.split(/[\\/]/).pop()!.slice(0, 200) || "Beleg.pdf";
  const sha256 = (await import("node:crypto")).createHash("sha256").update(opts.data).digest("hex");
  const same = await db.storedFile.findFirst({ where: { kind: "altbeleg", sha256 }, select: { id: true } });
  if (same) return { importId: imp.id, duplicate: true, matched: null };
  let file;
  try {
    file = await storeFile({ name, mime: "application/pdf", data: opts.data, kind: "altbeleg", uploadedBy: opts.userName });
  } catch (e) {
    throw e instanceof FileError ? new ErpImportError(e.message) : e;
  }
  await db.storedFile.update({ where: { id: file.id }, data: { meta: { importId: imp.id } } });
  await db.erpImport.update({ where: { id: imp.id }, data: { rows: { increment: 1 } } });
  const cands = numberCandidates(name);
  const recs = cands.length ? await db.erpRecord.findMany({ where: { number: { in: cands }, fileId: null, kind: { in: DOC_KINDS }, import: { format: { not: "pdf" } } }, select: { id: true, kind: true, number: true, party: true, lexId: true }, take: 20 }) : [];
  const hit = pick(name, recs);
  if (hit) {
    await db.erpRecord.update({ where: { id: hit.id }, data: { fileId: file.id } });
    // Schon in die Buchhaltung übernommen → Original-PDF auch dort
    if (hit.kind === "rechnung" && hit.lexId && !hit.lexId.includes("-")) await db.salesDoc.updateMany({ where: { id: hit.lexId, imported: true, pdf: null }, data: { pdf: new Uint8Array(opts.data) } });
    return { importId: imp.id, duplicate: false, matched: { id: hit.id, label: [ERP_KIND_LABEL[hit.kind as ErpKind], hit.number, hit.party].filter(Boolean).join(" · ") } };
  }
  const text = (file.text ?? "").slice(0, 3000);
  await db.erpRecord.create({
    data: {
      importId: imp.id,
      table: "Beleg-PDFs",
      kind: "sonstiges",
      number: cands[0]?.slice(0, 80) ?? null,
      name: name.replace(/\.pdf$/i, "").slice(0, 300),
      fields: { datei: name },
      raw: { Datei: name, ...(text ? { "Text (Anfang)": text.slice(0, 1500) } : {}) },
      search: `${name} ${text}`.toLowerCase().slice(0, 4000),
      fileId: file.id,
    },
  });
  return { importId: imp.id, duplicate: false, matched: null };
}

/** Nach einem Listen-Import: PDF-Platzhalter mit passender Nummer an den neuen Datensatz hängen */
export async function relinkPdfs(importId: string) {
  const targets = await db.erpRecord.findMany({ where: { importId, number: { not: null }, fileId: null, kind: { in: DOC_KINDS } }, select: { id: true, kind: true, number: true } });
  if (!targets.length) return 0;
  const byNumber = new Map<string, typeof targets>();
  for (const t of targets) byNumber.set(t.number!, [...(byNumber.get(t.number!) ?? []), t]);
  const placeholders = await db.erpRecord.findMany({ where: { import: { format: "pdf" }, fileId: { not: null } }, select: { id: true, fileId: true, fields: true }, take: 20_000 });
  const taken = new Set<string>();
  let n = 0;
  for (const p of placeholders) {
    const name = String((p.fields as Record<string, unknown>)?.datei ?? "");
    const hit = pick(name, numberCandidates(name).flatMap((c) => byNumber.get(c) ?? []).filter((t) => !taken.has(t.id)));
    if (!hit) continue;
    taken.add(hit.id);
    await db.$transaction([db.erpRecord.update({ where: { id: hit.id }, data: { fileId: p.fileId } }), db.erpRecord.delete({ where: { id: p.id } })]);
    n++;
  }
  return n;
}

/** Import löschen. PDF-Import: Dateien mit weg. Listen-Import: zugeordnete PDFs bleiben als Platzhalter in ihrem PDF-Import */
export async function deleteErpImport(importId: string) {
  const imp = await db.erpImport.findUniqueOrThrow({ where: { id: importId }, select: { id: true, format: true } });
  if (imp.format === "pdf") {
    const files = await db.storedFile.findMany({ where: { kind: "altbeleg", meta: { path: ["importId"], equals: imp.id } }, select: { id: true } });
    const ids = files.map((f) => f.id);
    await db.$transaction([db.erpRecord.updateMany({ where: { fileId: { in: ids } }, data: { fileId: null } }), db.erpImport.delete({ where: { id: imp.id } }), db.storedFile.deleteMany({ where: { id: { in: ids } } })]);
    return;
  }
  const linked = await db.erpRecord.findMany({ where: { importId: imp.id, fileId: { not: null } }, select: { fileId: true, number: true } });
  const files = linked.length ? await db.storedFile.findMany({ where: { id: { in: linked.map((l) => l.fileId!) } }, select: { id: true, name: true, meta: true } }) : [];
  const pdfImports = new Set((await db.erpImport.findMany({ where: { format: "pdf" }, select: { id: true } })).map((x) => x.id));
  await db.$transaction(async (tx) => {
    for (const f of files) {
      const owner = String((f.meta as Record<string, unknown> | null)?.importId ?? "");
      if (!pdfImports.has(owner)) {
        await tx.storedFile.delete({ where: { id: f.id } });
        continue;
      }
      await tx.erpRecord.create({ data: { importId: owner, table: "Beleg-PDFs", kind: "sonstiges", number: numberCandidates(f.name)[0] ?? null, name: f.name.replace(/\.pdf$/i, "").slice(0, 300), fields: { datei: f.name }, raw: { Datei: f.name }, search: f.name.toLowerCase(), fileId: f.id } });
    }
    await tx.erpImport.delete({ where: { id: imp.id } });
  });
}

// ---------- Suche ----------

export async function searchRecords(q: { text?: string; kind?: ErpKind; offen?: boolean; take?: number }) {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const and: object[] = words.map((w) => ({ search: { contains: w } }));
  // „offen“ = Rechnung ohne Status „bezahlt“/„storniert“ (Status leer zählt als offen)
  // Schon in die Buchhaltung übernommene Rechnungen stehen dort in den offenen Posten – hier nicht doppelt
  if (q.offen) and.push({ kind: "rechnung", lexId: null }, { OR: [{ status: null }, ...["offen", "nicht", "unbezahlt", "überfällig", "faellig", "fällig", "open", "overdue"].map((w) => ({ status: { contains: w, mode: "insensitive" } })), { NOT: { OR: ["bezahlt", "paid", "storn", "erledigt", "ausgeglichen", "zahlung unbekannt"].map((w) => ({ status: { contains: w, mode: "insensitive" } })) } }] });
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
