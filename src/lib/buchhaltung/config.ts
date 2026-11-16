import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";

// Einstellungen der Buchhaltung (Bankverbindung, Steuernummer, Zahlungsziel, Texte, Mahngebühren).
// Liegen als JSON in AppSetting „BUCHHALTUNG“ – keine Geheimnisse, deshalb unverschlüsselt.

const KEY = "BUCHHALTUNG";

/** Textbaustein für Angebote/Rechnungen (Einleitung/Schlusstext). „standard“ = steht bei neuen Belegen dieser Art automatisch unten im Schlusstext.
 *  Platzhalter {angebot} = Nummer und Datum des Angebots, aus dem die Rechnung entstand. */
export const textBlockSchema = z.object({
  title: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(2000),
  for: z.enum(["ALLE", "ANGEBOT", "RECHNUNG"]).default("ALLE"),
  standard: z.boolean().default(false),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const DEFAULT_TEXT_BLOCKS: TextBlock[] = [
  { title: "Leistung gemäß Angebot", text: "Die Leistung erfolgte gemäß unserem beiliegenden Angebot {angebot}.", for: "RECHNUNG", standard: false },
  { title: "VOB/B", text: "Grundlage dieses Vertrags ist die VOB Teil B (VOB/B) in der bei Vertragsschluss gültigen Fassung.", for: "ALLE", standard: false },
  { title: "AGB", text: "Es gelten unsere Allgemeinen Geschäftsbedingungen (AGB), die wir Ihnen auf Wunsch gerne zusenden.", for: "ALLE", standard: false },
  { title: "§ 13b UStG (Bauleistung)", text: "Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b Abs. 2 Nr. 4 i. V. m. Abs. 5 UStG: Die Umsatzsteuer für diese Bauleistung schuldet der Leistungsempfänger.", for: "RECHNUNG", standard: false },
  { title: "Freistellung § 48b EStG", text: "Eine gültige Freistellungsbescheinigung nach § 48b EStG liegt vor und wird Ihnen auf Wunsch gerne übersandt.", for: "RECHNUNG", standard: false },
  { title: "Aufmaß vor Fertigung", text: "Maßgeblich ist das gemeinsame Aufmaß vor der Fertigung. Mehr- oder Mindermengen werden nach Aufmaß abgerechnet.", for: "ANGEBOT", standard: false },
];

/** Bausteine, die zu dieser Belegart passen */
export const blocksFor = (blocks: TextBlock[], kind: string) => blocks.filter((b) => b.for === "ALLE" || b.for === kind);

/** Schlusstext für einen neuen Beleg: Standardtext + als „standard“ markierte Bausteine */
export function defaultOutro(c: BookConfig, kind: string, angebot: string | null = null) {
  const base = kind === "ANGEBOT" ? c.quoteOutro : kind === "RECHNUNG" ? c.invoiceOutro : "";
  const extra = kind === "GUTSCHRIFT" ? [] : blocksFor(c.textBlocks, kind).filter((b) => b.standard).map((b) => b.text);
  return fillBlock([...extra, base].filter(Boolean).join("\n\n"), angebot) || null;
}

/** Platzhalter füllen ({angebot} → „AN-2026-0012 vom 03.11.2026“ bzw. ohne Angebot entfernt) */
export const fillBlock = (text: string, angebot: string | null) => text.replace(/\s?\{angebot\}/g, angebot ? ` ${angebot}` : "");

const iban = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .refine((s) => s === "" || ibanValid(s), "IBAN prüfen – die Prüfziffer stimmt nicht.");

export const bookConfigSchema = z.object({
  iban: iban.default(""),
  bic: z.string().trim().max(11).transform((s) => s.replace(/\s+/g, "").toUpperCase()).default(""),
  bankName: z.string().trim().max(100).default(""),
  /** Steuernummer vom Finanzamt (zusätzlich zur USt-IdNr.) */
  taxNumber: z.string().trim().max(30).default(""),
  /** Zahlungsziel Rechnungen in Tagen */
  paymentDays: z.number().int().min(0).max(120).default(14),
  /** Angebote gültig in Tagen */
  quoteDays: z.number().int().min(1).max(365).default(30),
  quoteIntro: z.string().max(2000).default("vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:"),
  quoteOutro: z.string().max(2000).default("Wir freuen uns auf Ihren Auftrag. Bei Fragen sind wir gerne für Sie da."),
  invoiceIntro: z.string().max(2000).default("vielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:"),
  invoiceOutro: z.string().max(2000).default("Vielen Dank für die gute Zusammenarbeit."),
  /** Mahngebühr in Euro für die 1. und 2. Mahnung (Zahlungserinnerung kostenlos) */
  dunningFee1: z.number().min(0).max(100).default(5),
  dunningFee2: z.number().min(0).max(100).default(10),
  /** Neue Frist in Tagen bei Erinnerung/Mahnung */
  dunningDays: z.number().int().min(1).max(60).default(7),
  /** Mahnvorschläge (Mahnwesen): Erinnerung X Tage nach Fälligkeit, nächste Stufe Y Tage nach Ablauf der Mahnfrist.
   *  Es wird nie automatisch gesendet – nur vorgeschlagen; die Geschäftsführung gibt frei. */
  autoDunning: z.boolean().default(true),
  reminderAfterDays: z.number().int().min(0).max(60).default(7),
  nextLevelAfterDays: z.number().int().min(0).max(60).default(5),
  /** Kleinbeträge nicht mahnen (Euro, offen) */
  dunningMinEuro: z.number().min(0).max(1000).default(5),
  /** Name im Absender der E-Rechnung (Ansprechpartner) */
  contactName: z.string().trim().max(100).default("Buchhaltung"),
  /** DATEV: Beraternummer (vom Steuerberater), Mandantennummer, Kontenrahmen, Beginn Wirtschaftsjahr (Monat) */
  datevBerater: z.string().trim().regex(/^\d{0,7}$/, "Beraternummer: bis zu 7 Ziffern").default(""),
  datevMandant: z.string().trim().regex(/^\d{0,5}$/, "Mandantennummer: bis zu 5 Ziffern").default(""),
  datevSkr: z.enum(["03", "04"]).default("03"),
  datevWjMonth: z.number().int().min(1).max(12).default(1),
  /** Textbausteine (VOB/B, AGB, § 13b, „gemäß beiliegendem Angebot“ …) */
  textBlocks: z.array(textBlockSchema).max(30).default(DEFAULT_TEXT_BLOCKS),
  /** Angebot angenommen → Auftragsbestätigung an den Kunden vorschlagen */
  confirmOnAccept: z.boolean().default(true),
  /** Eigenes Briefpapier (PDF oder Bild, A4) als Hintergrund für alle Angebote, Rechnungen, Gutschriften, Mahnungen und
   *  Auftragsbestätigungen. StoredFile kind „briefpapier“. Erste Seite = Briefkopf, optional zweite Seite für Folgeseiten. */
  letterheadFileId: z.string().max(40).nullable().default(null),
  letterheadName: z.string().max(200).nullable().default(null),
  /** Briefpapier hat eigenen Kopf/Fuß → Logo und Fußzeile von Jarvis weglassen */
  letterheadOnly: z.boolean().default(true),
  /** Freiraum oben (Folgeseiten) und unten in mm, damit der Text nicht in Kopf/Fuß des Briefpapiers läuft */
  letterheadTopMm: z.number().int().min(10).max(80).default(30),
  letterheadBottomMm: z.number().int().min(10).max(80).default(30),
});
export type BookConfig = z.infer<typeof bookConfigSchema>;

export async function bookConfig(): Promise<BookConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = bookConfigSchema.safeParse(raw);
  return withCompanyBank(p.success ? p.data : bookConfigSchema.parse({}));
}

/** Leere Bankverbindung → Standard von ProMont (Briefpapier). Eigene Einträge haben immer Vorrang. */
export function withCompanyBank(c: BookConfig): BookConfig {
  if (c.iban) return c;
  return { ...c, iban: COMPANY.bank.iban, bic: c.bic || COMPANY.bank.bic, bankName: c.bankName || COMPANY.bank.name };
}

export async function saveBookConfig(c: BookConfig) {
  const value = JSON.stringify(bookConfigSchema.parse(c));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

/** Was fehlt noch, bevor Rechnungen festgeschrieben werden können? */
export function missingForInvoices(c: BookConfig) {
  const m: string[] = [];
  if (!c.iban) m.push("IBAN");
  if (!c.bankName && !c.bic) m.push("Bank bzw. BIC");
  return m;
}

/** IBAN-Prüfziffer (ISO 13616, mod 97) */
export function ibanValid(s: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of r) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export const fmtIban = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();
