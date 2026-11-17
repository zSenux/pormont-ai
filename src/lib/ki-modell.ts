import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_MODEL_CONFIG, KI_FEATURES, KI_MODEL_IDS, supportsFallbacks, type KiFeature, type KiModelConfig } from "./ki-modell-shared";

// Welches Claude-Modell welche Funktion nutzt – AppSetting KI_MODELL (nur Admin, Seite /ki-kosten).
// Ohne Einstellung läuft alles mit dem günstigsten Modell (Haiku 5.5).

const KEY = "KI_MODELL";
const modelId = z.enum(KI_MODEL_IDS);
export const kiModelSchema = z.object({
  standard: modelId,
  features: z.partialRecord(z.enum(KI_FEATURES.map((f) => f.key) as [KiFeature, ...KiFeature[]]), modelId),
});

let cache: { at: number; cfg: KiModelConfig } | null = null;

export async function kiModelConfig(): Promise<KiModelConfig> {
  if (cache && Date.now() - cache.at < 15_000) return cache.cfg;
  let cfg = DEFAULT_MODEL_CONFIG;
  try {
    const row = await db.appSetting.findUnique({ where: { key: KEY } });
    const p = kiModelSchema.safeParse(row ? JSON.parse(row.value) : null);
    if (p.success) cfg = p.data;
  } catch {}
  cache = { at: Date.now(), cfg };
  return cfg;
}

export async function saveKiModelConfig(c: KiModelConfig) {
  const value = JSON.stringify(kiModelSchema.parse(c));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
}

/** Modell für eine Funktion: eigene Wahl, sonst Standard (= günstigstes) */
export async function kiModel(feature: KiFeature): Promise<string> {
  const cfg = await kiModelConfig();
  return cfg.features[feature] ?? cfg.standard;
}

/** Serverseitiger Ersatz bei Ablehnung – nur für Modelle, die ihn kennen */
export function fallbackParams(model: string) {
  return supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
}
