import "server-only";
import { db } from "@/lib/db";

// USD je 1 Mio. Tokens (Stand 11/2026) – längstes Präfix gewinnt
const PRICES: [string, number, number][] = [
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4", 1, 5],
];

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function claudeUsd(model: string, u: Usage) {
  const p = PRICES.filter(([k]) => model.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0] ?? PRICES[0];
  const input = u.input_tokens + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25;
  return (input * p[1] + u.output_tokens * p[2]) / 1_000_000;
}

/** Nach jedem Claude-Aufruf erfassen (Fehler egal) */
export async function trackClaude(feature: string, model: string, u: Usage) {
  await db.apiUsage
    .create({ data: { feature, model, input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens, costMicro: Math.round(claudeUsd(model, u) * 10_000) } })
    .catch(() => {});
}
