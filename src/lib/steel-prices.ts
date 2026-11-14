import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { STEEL_FAMILIES } from "@/lib/steel";

// Eigene Einkaufspreise für den Stahl-Katalog: Euro je kg (netto) je Werkstoff, optional je Profilart abweichend,
// plus Zuschlag fürs Verzinken. Trägt der Betrieb unter /lieferanten/stahl ein – nichts davon ist vorbelegt.
// AppSetting „STAHLPREISE“ (keine Geheimnisse, unverschlüsselt).

const KEY = "STAHLPREISE";
const eurKg = z.number().finite().min(0).max(1000).nullable().optional();

export const steelPriceSchema = z.object({
  STAHL: eurKg,
  EDELSTAHL: eurKg,
  ALU: eurKg,
  /** Zuschlag Feuerverzinken € je kg */
  verzinken: eurKg,
  /** abweichende Preise € je kg für einzelne Profilarten (z. B. Träger teurer als Flachstahl) */
  familien: z.partialRecord(z.enum(STEEL_FAMILIES), z.number().finite().min(0).max(1000)).default({}),
  /** woher die Preise stammen, z. B. „Haug, Angebot 11/2026“ */
  quelle: z.string().trim().max(200).nullable().optional(),
  stand: z.string().max(40).nullable().optional(),
});
export type SteelPrices = z.infer<typeof steelPriceSchema>;

export async function steelPrices(): Promise<SteelPrices> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = steelPriceSchema.safeParse(raw);
  return p.success ? p.data : steelPriceSchema.parse({});
}

export async function saveSteelPrices(p: SteelPrices) {
  const value = JSON.stringify(steelPriceSchema.parse(p));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export { pricePerKg, priceOf } from "@/lib/steel";
