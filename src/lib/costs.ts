import "server-only";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/user";

// Listenpreise der Anthropic-API in USD je 1 Mio. Tokens (Stand 11/2026) – längstes Präfix gewinnt.
// [Präfix, Eingabe, Ausgabe, Cache-Lesen]; Cache-Schreiben (5 Min.) = 1,25 × Eingabe
const PRICES: [string, number, number, number][] = [
  ["claude-fable-5-2", 8, 40, 0.2],
  ["claude-mythos-5-2", 8, 40, 0.2],
  ["claude-fable-5", 10, 50, 1],
  ["claude-mythos-5", 10, 50, 1],
  ["claude-opus-5-5", 4, 20, 0.2],
  ["claude-opus-5", 5, 25, 0.5],
  ["claude-opus-4", 5, 25, 0.5],
  ["claude-sonnet-5-5", 2, 10, 0.1],
  ["claude-sonnet-5", 2, 10, 0.2],
  ["claude-sonnet-4", 3, 15, 0.3],
  ["claude-haiku-5-5", 0.1, 0.5, 0.01],
  ["claude-haiku-4", 1, 5, 0.1],
];
/** Haiku 5.5 hat zwei Preisstufen: über 100.000 Tokens Eingabe je Aufruf gilt der höhere Satz */
const LONG_PROMPT: Record<string, [number, number, number]> = { "claude-haiku-5-5": [0.5, 2.5, 0.05] };
const LONG_FROM = 100_000;
/** Websuche: 10 USD je 1.000 Suchen */
const WEB_SEARCH_USD = 0.01;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export function claudeUsd(model: string, u: Usage) {
  const p = PRICES.filter(([k]) => model.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0] ?? PRICES.find(([k]) => k === "claude-opus-5-5")!;
  const prompt = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const long = LONG_PROMPT[p[0]];
  const [inUsd, outUsd, readUsd] = long && prompt > LONG_FROM ? long : [p[1], p[2], p[3]];
  const usd = u.input_tokens * inUsd + (u.cache_read_input_tokens ?? 0) * readUsd + (u.cache_creation_input_tokens ?? 0) * inUsd * 1.25 + u.output_tokens * outUsd;
  return usd / 1_000_000 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** Nach jedem Claude-Aufruf erfassen (Fehler egal). Ohne userId wird – wenn vorhanden – der angemeldete Nutzer genommen. */
export async function trackClaude(feature: string, model: string, u: Usage, userId?: string | null) {
  try {
    const uid = userId === undefined ? ((await currentUser().catch(() => null))?.id ?? null) : userId;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    await db.apiUsage.create({
      data: {
        feature,
        model,
        input: u.input_tokens + cacheRead + cacheWrite,
        output: u.output_tokens,
        cacheRead,
        cacheWrite,
        webSearches: u.server_tool_use?.web_search_requests ?? 0,
        costMicro: Math.round(claudeUsd(model, u) * 10_000),
        userId: uid,
      },
    });
  } catch {}
}
