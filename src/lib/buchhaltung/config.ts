import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

// Einstellungen der Buchhaltung (Bankverbindung, Steuernummer, Zahlungsziel, Texte, Mahngebühren).
// Liegen als JSON in AppSetting „BUCHHALTUNG“ – keine Geheimnisse, deshalb unverschlüsselt.

const KEY = "BUCHHALTUNG";

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
  /** Name im Absender der E-Rechnung (Ansprechpartner) */
  contactName: z.string().trim().max(100).default("Buchhaltung"),
});
export type BookConfig = z.infer<typeof bookConfigSchema>;

export async function bookConfig(): Promise<BookConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = bookConfigSchema.safeParse(raw);
  return p.success ? p.data : bookConfigSchema.parse({});
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
