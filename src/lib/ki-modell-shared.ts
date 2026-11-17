// KI-Modell je Funktion (ohne server-only, auch für die Einstellungs-Seite).
// Standard ist das günstigste Claude-Modell (Haiku 5.5); der Admin kann unter /ki-kosten je Funktion ein stärkeres wählen.

export const KI_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "am günstigsten", inUsd: 0.1, outUsd: 0.5 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Mittelklasse", inUsd: 2, outUsd: 10 },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "am stärksten", inUsd: 4, outUsd: 20 },
] as const;
export type KiModelId = (typeof KI_MODELS)[number]["id"];
export const KI_MODEL_IDS = KI_MODELS.map((m) => m.id) as [KiModelId, ...KiModelId[]];

/** Das günstigste Modell = Standard („Sparmodus“) */
export const CHEAPEST_MODEL: KiModelId = "claude-haiku-5-5";

export const KI_FEATURES = [
  { key: "chat", label: "Jarvis (Chat, Sprache, Telefon)", hint: "" },
  { key: "pc", label: "Jarvis am PC (Computer-Steuerung)", hint: "Bei langen Aufgaben am PC arbeitet Sonnet zuverlässiger." },
  { key: "beleg", label: "Belege auslesen", hint: "" },
  { key: "dokument", label: "Scans abschreiben (Dokumentensuche)", hint: "" },
  { key: "katalog", label: "Lieferanten-Kataloge aus PDF", hint: "" },
  { key: "angebot", label: "Angebot per Sprache", hint: "" },
  { key: "akquise", label: "Akquise (Leitfaden, Brief)", hint: "" },
] as const;
export type KiFeature = (typeof KI_FEATURES)[number]["key"];

export type KiModelConfig = { standard: KiModelId; features: Partial<Record<KiFeature, KiModelId>> };
export const DEFAULT_MODEL_CONFIG: KiModelConfig = { standard: CHEAPEST_MODEL, features: {} };

export const modelInfo = (id: string) => KI_MODELS.find((m) => m.id === id);

/** Haiku hat keinen serverseitigen Ersatz bei Ablehnung – dort `fallbacks` weglassen (sonst 400 bzw. wirkungslos) */
export const supportsFallbacks = (model: string) => !model.startsWith("claude-haiku");
