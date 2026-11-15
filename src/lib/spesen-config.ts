import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_SPESEN_RATES, type SpesenRates } from "@/lib/spesen";

// Spesensätze der Firma (AppSetting „SPESEN“, nur Admin). Ohne Eintrag gelten die gesetzlichen Pauschalen.

const KEY = "SPESEN";
const cents = z.number().int().min(0).max(100_000);
export const ratesSchema = z.object({
  meal: z.object({ TAG8: cents, REISE: cents, TAG24: cents }),
  km: z.number().int().min(0).max(200),
  night: cents,
});

export async function spesenRates(): Promise<SpesenRates> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  try {
    const p = ratesSchema.safeParse(row ? JSON.parse(row.value) : null);
    if (p.success) return p.data;
  } catch {}
  return DEFAULT_SPESEN_RATES;
}

export async function saveSpesenRates(r: SpesenRates) {
  const value = JSON.stringify(ratesSchema.parse(r));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
