import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime } from "@/lib/berlin";
import { decodeText, splitCsv } from "@/lib/catalog";
import { norm, xlsxSheets } from "@/lib/erp-import";

// Liste potenzieller Kunden (Excel .xlsx oder CSV) in die Akquise übernehmen.
// Ablauf wie bei der Google-Suche: Datei hochladen → erkannte Zeilen werden als LeadImport gespeichert →
// Vorschau mit Haken → „Übernehmen“ legt Leads aus den gespeicherten Zeilen an (nie aus Browser-Daten).
// Dateiinhalte sind fremde Daten – Text darin ist nie eine Anweisung.

export const MAX_LIST_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 2000;

export class ListImportError extends Error {}

export const LIST_FIELDS = ["name", "category", "contactName", "email", "phone", "website", "street", "postalCode", "city", "value", "notes", "status", "followUp"] as const;
export type ListField = (typeof LIST_FIELDS)[number];
export const LIST_FIELD_LABEL: Record<ListField, string> = {
  name: "Firma", category: "Branche", contactName: "Ansprechpartner", email: "E-Mail", phone: "Telefon", website: "Website",
  street: "Straße", postalCode: "PLZ", city: "Ort", value: "Auftragswert", notes: "Notiz", status: "Status", followUp: "Wiedervorlage",
};

// Regeln je Feld in Vorrang-Reihenfolge, geprüft gegen den vereinheitlichten Spaltennamen (norm)
const RULES: Record<ListField, RegExp[]> = {
  name: [/^(firma|firmenname|unternehmen|unternehmensname|company|kunde|kundenname|potenziellerkunde|potentiellerkunde|interessent|bauherr|auftraggeber)$/, /^(firma|unternehmen|company|kunde|interessent)/, /^name$/, /^name1$/],
  category: [/^(branche|kategorie|gewerk|bereich|segment|zielgruppe|typ|art)$/, /branche|kategorie|gewerk/],
  contactName: [/^(ansprechpartner|ansprechperson|kontakt|kontaktperson|ap|person|vorname?nachname|nachname)$/, /ansprech|kontaktperson|^kontaktname/],
  email: [/^(email|mail|emailadresse|mailadresse)$/, /mail/],
  phone: [/^(telefon|tel|telefonnummer|telnr|phone|rufnummer|mobil|handy|mobilnummer)$/, /telefon|^tel|phone|mobil|handy/],
  website: [/^(website|webseite|homepage|internet|internetseite|url|web|www)$/, /website|webseite|homepage|internet|url/],
  street: [/^(strasse|str|strassehausnummer|strassenr|adresse|anschrift|address)$/, /strasse|adresse|anschrift/],
  postalCode: [/^(plz|postleitzahl|zip)$/, /^plz/],
  city: [/^(ort|stadt|city|wohnort|sitz|standort|plzort)$/, /^ort|stadt|standort/],
  // „Potenzial“ ist oft Hoch/Mittel/Niedrig – bleibt dann als Text in der Notiz
  value: [/^(auftragswert|wert|volumen|auftragsvolumen|umsatz|budget)$/, /auftragswert|auftragsvolumen/],
  notes: [/^(bemerkung|bemerkungen|notiz|notizen|kommentar|info|infos|hinweis|beschreibung)$/, /bemerk|notiz|kommentar|hinweis/],
  status: [/^(status|stand|stufe|phase)$/],
  followUp: [/^(wiedervorlage|nachfassen|naechsterkontakt|wiedervorlageam|nachfassenam)$/],
};

export const listRowSchema = z.object({
  name: z.string(),
  category: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  value: z.number().int().nullable(),
  notes: z.string().nullable(),
  stage: z.enum(["NEU", "KONTAKTIERT", "TERMIN", "ANGEBOT", "GEWONNEN", "VERLOREN"]),
  /// Wiedervorlage JJJJ-MM-TT
  followUp: z.string().nullable(),
  /// nicht zugeordnete Spalten „Spalte: Wert“
  extra: z.array(z.string()),
  sheet: z.string(),
});
export type ListRow = z.infer<typeof listRowSchema>;

function mapHeaders(headers: string[]) {
  const mapping: Partial<Record<ListField, number>> = {};
  const used = new Set<number>();
  const normed = headers.map(norm);
  // erst alle exakten Regeln, dann die lockeren – sonst schnappt „Kundennummer“ dem „Firma“-Feld nichts weg, aber „Kunde“ die Firma
  for (const pass of [0, 1, 2, 3]) {
    for (const f of LIST_FIELDS) {
      if (mapping[f] !== undefined) continue;
      const re = RULES[f][pass];
      if (!re) continue;
      const i = normed.findIndex((h, j) => h && !used.has(j) && re.test(h) && !/nr$|nummer$|^id$|^nr/.test(h));
      if (i >= 0) {
        mapping[f] = i;
        used.add(i);
      }
    }
  }
  return mapping;
}

/** Kopfzeile in den ersten 15 Zeilen suchen (Titelzeilen darüber sind erlaubt): die mit den meisten erkannten Spalten */
function findHeader(m: string[][]) {
  let best = { row: -1, score: 0, mapping: {} as Partial<Record<ListField, number>> };
  for (let r = 0; r < Math.min(15, m.length - 1); r++) {
    const mapping = mapHeaders(m[r].map((h) => (h ?? "").trim()));
    const score = Object.keys(mapping).length + (mapping.name !== undefined ? 2 : 0);
    if (score > best.score) best = { row: r, score, mapping };
  }
  return best;
}

const clean = (s: string | undefined) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v && v !== "-" && v !== "–" ? v : null;
};

function parseValue(s: string | null) {
  if (!s) return null;
  const t = s.replace(/[€\s]|eur/gi, "");
  const k = /^(\d+(?:[.,]\d+)?)\s*(k|tsd|t)$/i.exec(t);
  if (k) return Math.round(parseFloat(k[1].replace(",", ".")) * 1000);
  const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n) : null;
}

/** Status-Text der Liste → Stufe. Verneinungen zuerst („Nicht angerufen“ ist noch neu). */
function parseStage(s: string | null): ListRow["stage"] {
  const v = (s ?? "").toLowerCase().trim();
  if (!v || /^nicht (angerufen|erreicht|kontaktiert)|^offen|^neu/.test(v)) return "NEU";
  if (/kein bedarf|kein interesse|absage|abgesagt|verloren|nicht mehr kontaktieren/.test(v)) return "VERLOREN";
  if (/auftrag (erhalten|erstellt)|gewonnen|kunde geworden/.test(v)) return "GEWONNEN";
  if (/angebot|verhandlung/.test(v)) return "ANGEBOT";
  if (/termin/.test(v)) return "TERMIN";
  return "KONTAKTIERT";
}

/** Datum aus Excel (Seriennummer) oder TT.MM.JJJJ / JJJJ-MM-TT → JJJJ-MM-TT */
function parseYmd(s: string | null) {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
  return null;
}

function website(s: string | null) {
  if (!s) return null;
  const v = s.replace(/\s/g, "");
  if (!/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v.replace(/^https?:\/\//i, ""))) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** „Musterstr. 1, 68159 Mannheim“ bzw. „68159 Mannheim“ zerlegen */
function splitAddress(row: { street: string | null; postalCode: string | null; city: string | null }) {
  let { street, postalCode, city } = row;
  if (street && !postalCode && !city) {
    const m = /^(.*?)[,\s]+(\d{5})\s+(.+)$/.exec(street);
    if (m) (street = m[1].replace(/,$/, "").trim() || null), (postalCode = m[2]), (city = m[3].trim());
  }
  if (city && !postalCode) {
    const m = /^(\d{5})\s+(.+)$/.exec(city);
    if (m) (postalCode = m[1]), (city = m[2]);
  }
  if (postalCode && !/^\d{4,5}$/.test(postalCode)) postalCode = /\d{5}/.exec(postalCode)?.[0] ?? null;
  return { street, postalCode, city };
}

function matrices(fileName: string, buf: Buffer): { name: string; matrix: string[][] }[] {
  const lower = fileName.toLowerCase();
  if (buf.subarray(0, 2).toString() === "PK" || lower.endsWith(".xlsx")) {
    try {
      return xlsxSheets(buf);
    } catch {
      throw new ListImportError("Die Excel-Datei ist nicht lesbar – bitte als .xlsx oder CSV speichern.");
    }
  }
  if (lower.endsWith(".xls")) throw new ListImportError("Altes Excel-Format (.xls) – bitte als .xlsx oder CSV speichern.");
  const text = decodeText(buf);
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  return [{ name: fileName.replace(/\.[^.]+$/, ""), matrix: splitCsv(text, sep) }];
}

/** Datei lesen → erkannte Interessenten (ohne Speichern) */
export function parseLeadList(fileName: string, buf: Buffer) {
  const rows: ListRow[] = [];
  const mapping: Record<string, string> = {};
  for (const sheet of matrices(fileName, buf)) {
    if (sheet.matrix.length < 2) continue;
    const head = findHeader(sheet.matrix);
    // Auswahllisten-Blätter (z. B. „Dropdowns“) haben keine echte Kopfzeile mit Firma + weiteren Spalten
    if (head.row < 0 || head.mapping.name === undefined || head.score < 4) continue;
    const headers = sheet.matrix[head.row].map((h, i) => clean(h) ?? `Spalte ${i + 1}`);
    for (const [f, i] of Object.entries(head.mapping)) mapping[`${sheet.name} · ${headers[i!]}`] = LIST_FIELD_LABEL[f as ListField];
    // Status-Text bleibt zusätzlich in der Notiz (die Stufen der Akquise sind gröber als die der Liste)
    const mapped = new Set(Object.entries(head.mapping).flatMap(([f, i]) => (f === "status" ? [] : [i!])));
    for (const r of sheet.matrix.slice(head.row + 1)) {
      const get = (f: ListField) => (head.mapping[f] === undefined ? null : clean(r[head.mapping[f]!]));
      const name = get("name");
      if (!name || name.length < 2) continue;
      const email = get("email");
      const site = website(get("website"));
      // keine Adresse (z. B. „Google Maps“) → Text bleibt in der Notiz
      const skip = (i: number) => mapped.has(i) && !(i === head.mapping.website && !site);
      const addr = splitAddress({ street: get("street"), postalCode: get("postalCode"), city: get("city") });
      rows.push({
        name: name.slice(0, 200),
        category: get("category")?.slice(0, 120) ?? null,
        contactName: get("contactName")?.slice(0, 120) ?? null,
        email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase().slice(0, 200) : null,
        phone: get("phone")?.slice(0, 60) ?? null,
        website: site?.slice(0, 300) ?? null,
        street: addr.street?.slice(0, 200) ?? null,
        postalCode: addr.postalCode,
        city: addr.city?.slice(0, 120) ?? null,
        value: parseValue(get("value")),
        notes: get("notes")?.slice(0, 2000) ?? null,
        stage: parseStage(get("status")),
        followUp: parseYmd(get("followUp")),
        extra: r.flatMap((v, i) => (skip(i) || !clean(v) ? [] : [`${headers[i]}: ${clean(v)!.slice(0, 300)}`])).slice(0, 20),
        sheet: sheet.name,
      });
      if (rows.length >= MAX_ROWS) break;
    }
  }
  if (!rows.length) throw new ListImportError("In der Datei wurde keine Spalte mit Firmennamen gefunden (z. B. „Firma“, „Unternehmen“ oder „Name“).");
  return { rows, mapping };
}

export async function saveLeadList(opts: { fileName: string; data: Buffer; userId: string }) {
  const { rows, mapping } = parseLeadList(opts.fileName, opts.data);
  return db.leadImport.create({ data: { fileName: opts.fileName.slice(0, 200), rows, mapping, createdById: opts.userId } });
}

// ---------- Doppelte erkennen ----------
const LEGAL = /\b(gmbh|mbh|ag|kg|ohg|gbr|ug|e\.?\s?k|e\.?\s?v|co|haftungsbeschraenkt|inh|inhaber|und|u)\b/g;
export function nameKey(name: string) {
  return norm(name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(LEGAL, " "));
}
const phoneKey = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").replace(/^0049|^49/, "0");
  return d.length >= 6 ? d : null;
};

/** Welche Zeilen gibt es schon in der Akquise (Name, E-Mail oder Telefon gleich) bzw. doppelt in der Liste? */
export async function duplicates(rows: ListRow[]) {
  const leads = await db.lead.findMany({ select: { id: true, name: true, email: true, phone: true } });
  const names = new Map(leads.map((l) => [nameKey(l.name), l.id]));
  const mails = new Map(leads.flatMap((l) => (l.email ? [[l.email.toLowerCase(), l.id] as const] : [])));
  const phones = new Map(leads.flatMap((l) => { const k = phoneKey(l.phone); return k ? [[k, l.id] as const] : []; }));
  const seen = new Set<string>();
  return rows.map((r) => {
    const key = nameKey(r.name);
    const existing = names.get(key) ?? (r.email ? mails.get(r.email) : undefined) ?? (phoneKey(r.phone) ? phones.get(phoneKey(r.phone)!) : undefined);
    const twice = seen.has(key);
    seen.add(key);
    return existing ? { leadId: existing } : twice ? { twice: true } : null;
  });
}

/** Ausgewählte Zeilen (Index) als Leads anlegen – Daten aus dem gespeicherten Import */
export async function transferLeadList(importId: string, picked: number[], user: { id: string; name: string }) {
  const imp = await db.leadImport.findUniqueOrThrow({ where: { id: importId } });
  const rows = z.array(listRowSchema).parse(imp.rows);
  const dup = await duplicates(rows);
  const want = new Set(picked);
  let n = 0;
  for (const [i, r] of rows.entries()) {
    if (!want.has(i) || dup[i]) continue;
    const notes = [r.notes, r.extra.length ? r.extra.join("\n") : null].filter(Boolean).join("\n\n") || null;
    await db.lead.create({
      data: {
        name: r.name, category: r.category, contactName: r.contactName, email: r.email, phone: r.phone, website: r.website,
        street: r.street, postalCode: r.postalCode, city: r.city, value: r.value, notes, stage: r.stage, source: "LISTE", createdById: user.id,
        nextFollowUpAt: r.followUp ? berlinDateTime(r.followUp, "09:00") : null,
        activities: { create: { kind: "NOTIZ", text: `Aus der Liste „${imp.fileName}“ übernommen.`, userName: user.name } },
      },
    });
    n++;
  }
  return n;
}
