import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinParts } from "@/lib/berlin";
import { monthRange } from "@/lib/zeiten";
import { claudeUsd } from "@/lib/costs";
import { CHEAPEST_MODEL } from "@/lib/ki-modell-shared";

// KI-Kosten (Seite /ki-kosten, nur Admin): Auswertung der Tabelle ApiUsage, die trackClaude() nach jedem Claude-Aufruf füllt.
// Kosten sind Schätzungen nach Listenpreis in USD (costMicro = USD × 10.000) und werden mit dem eingestellten Kurs in Euro umgerechnet.
// Maßgeblich bleibt die Rechnung von Anthropic (console.anthropic.com → Billing).

const KEY = "KI_KOSTEN";
export const kiConfigSchema = z.object({
  usdEur: z.number().min(0.3).max(3),
  budgetEur: z.number().min(0).max(100_000).nullable(),
});
export type KiConfig = z.infer<typeof kiConfigSchema>;
export const DEFAULT_KI_CONFIG: KiConfig = { usdEur: 0.86, budgetEur: null };

export async function kiConfig(): Promise<KiConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  try {
    const p = kiConfigSchema.safeParse(row ? JSON.parse(row.value) : null);
    if (p.success) return p.data;
  } catch {}
  return DEFAULT_KI_CONFIG;
}

export async function saveKiConfig(c: KiConfig) {
  const value = JSON.stringify(kiConfigSchema.parse(c));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

/** costMicro-Summe → Euro */
export const microToEur = (micro: number, cfg: KiConfig) => (micro / 10_000) * cfg.usdEur;

type Sum = { n: number; input: number; output: number; cacheRead: number; cacheWrite: number; web: number; micro: number };
export type KiRow = Sum & { key: string; label: string };

const sumOf = (s: { _count: { _all: number }; _sum: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; webSearches: number | null; costMicro: number | null } }): Sum => ({
  n: s._count._all,
  input: s._sum.input ?? 0,
  output: s._sum.output ?? 0,
  cacheRead: s._sum.cacheRead ?? 0,
  cacheWrite: s._sum.cacheWrite ?? 0,
  web: s._sum.webSearches ?? 0,
  micro: s._sum.costMicro ?? 0,
});
const SUM = { input: true, output: true, cacheRead: true, cacheWrite: true, webSearches: true, costMicro: true } as const;

/** Kurzname eines Modells, z. B. „claude-opus-5-5“ → „Opus 5.5“ */
export function modelLabel(model: string) {
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** Monatsbericht: Summen, je Tag, je Funktion/Nutzer/Modell, 12-Monats-Verlauf */
export async function kiReport(month: string) {
  const { from, to } = monthRange(month);
  const where = { createdAt: { gte: from, lt: to } };
  const [y, m] = month.split("-").map(Number);
  const yearAgo = monthRange(`${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`).from;

  const [total, byFeature, byUser, byModel, days, months, cfg] = await Promise.all([
    db.apiUsage.aggregate({ where, _count: { _all: true }, _sum: SUM }),
    db.apiUsage.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: SUM }),
    db.apiUsage.groupBy({ by: ["userId"], where, _count: { _all: true }, _sum: SUM }),
    db.apiUsage.groupBy({ by: ["model"], where, _count: { _all: true }, _sum: SUM }),
    db.$queryRaw<{ d: string; n: number; micro: bigint; tokens: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS d,
             count(*)::int AS n, coalesce(sum("costMicro"), 0)::bigint AS micro, coalesce(sum("input" + "output"), 0)::bigint AS tokens
      FROM "ApiUsage" WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ m: string; n: number; micro: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM') AS m,
             count(*)::int AS n, coalesce(sum("costMicro"), 0)::bigint AS micro
      FROM "ApiUsage" WHERE "createdAt" >= ${yearAgo} AND "createdAt" < ${to} GROUP BY 1 ORDER BY 1`,
    kiConfig(),
  ]);

  const userIds = byUser.map((u) => u.userId).filter((x): x is string => !!x);
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const sortRows = (r: KiRow[]) => r.sort((a, b) => b.micro - a.micro);

  // Alle Tage des Monats (auch ohne Aufrufe), heute = letzter Tag im laufenden Monat
  const dayCount = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const now = berlinParts();
  const current = now.ymd.slice(0, 7) === month;
  const dayMap = new Map(days.map((d) => [d.d, d]));
  const dayList = Array.from({ length: dayCount }, (_, i) => {
    const ymd = `${month}-${String(i + 1).padStart(2, "0")}`;
    const d = dayMap.get(ymd);
    return { ymd, n: d?.n ?? 0, micro: Number(d?.micro ?? 0), tokens: Number(d?.tokens ?? 0), future: current && i + 1 > now.d };
  });

  // 12 Monate bis einschließlich des gewählten Monats
  const monthMap = new Map(months.map((x) => [x.m, x]));
  const monthList = Array.from({ length: 12 }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 12 + i, 1));
    const key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    const x = monthMap.get(key);
    return { month: key, n: x?.n ?? 0, micro: Number(x?.micro ?? 0) };
  });

  const sum = sumOf(total);
  // Was derselbe Verbrauch mit dem günstigsten Modell ungefähr gekostet hätte (Summen je Modell, daher nur „ca.“)
  const cheapestMicro = byModel.reduce((acc, x) => {
    const s = sumOf(x);
    const usd = claudeUsd(CHEAPEST_MODEL, { input_tokens: s.input - s.cacheRead - s.cacheWrite, output_tokens: s.output, cache_read_input_tokens: s.cacheRead, cache_creation_input_tokens: s.cacheWrite });
    return acc + Math.round(usd * 10_000) + s.web * 100;
  }, 0);
  const elapsed = current ? now.d : dayCount;
  const today = current ? (dayMap.get(now.ymd) ? Number(dayMap.get(now.ymd)!.micro) : 0) : null;
  return {
    cfg,
    sum,
    today,
    /** Hochrechnung aufs Monatsende (nur laufender Monat) */
    forecastMicro: current && elapsed > 0 ? Math.round((sum.micro / elapsed) * dayCount) : null,
    current,
    cheapestMicro,
    days: dayList,
    months: monthList,
    byFeature: sortRows(byFeature.map((f) => ({ key: f.feature, label: f.feature, ...sumOf(f) }))),
    byUser: sortRows(byUser.map((u) => ({ key: u.userId ?? "-", label: u.userId ? (userName.get(u.userId) ?? "Gelöschter Nutzer") : "Ohne Nutzer (Hintergrund)", ...sumOf(u) }))),
    byModel: sortRows(byModel.map((x) => ({ key: x.model, label: modelLabel(x.model), ...sumOf(x) }))),
  };
}

/** Kosten des laufenden Monats in Euro (für Budget-Warnung) */
export async function monthCostEur() {
  const { from, to } = monthRange(berlinParts().ymd.slice(0, 7));
  const [agg, cfg] = await Promise.all([db.apiUsage.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { costMicro: true } }), kiConfig()]);
  return { eur: microToEur(agg._sum.costMicro ?? 0, cfg), cfg };
}
