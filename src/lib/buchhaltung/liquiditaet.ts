import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { customerName, openCentsOf } from "./docs";
import { fmtEuroCents } from "./money";

// Liquiditätsplanung: Vorschau der nächsten Wochen aus echten Daten der Buchhaltung –
// offene Rechnungen (Eingang am Fälligkeitstag), offene Ausgaben/Eingangsrechnungen (Ausgang am Fälligkeitstag,
// sonst Belegdatum + 14 Tage), genehmigte, noch nicht ausgezahlte Spesen und geplante Zahlungen (CashItem:
// Löhne, Miete, Leasing, Steuern …). Startwert = Kontostand laut Eingabe + Bankumsätze danach (Bankabgleich).
// Überfälliges fällt in die aktuelle Woche und wird markiert. Keine Prognose aus der Luft: was nicht erfasst ist, fehlt.

const KEY = "LIQUIDITAET";
export const liqConfigSchema = z.object({
  /** Kontostand (Cent) am Stichtag */
  balanceCents: z.number().int().nullable().default(null),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Warnschwelle: Mindestreserve (Cent) */
  reserveCents: z.number().int().min(0).default(1_000_000),
  /** Wie viele Wochen voraus */
  weeks: z.number().int().min(4).max(26).default(12),
});
export type LiqConfig = z.infer<typeof liqConfigSchema>;

export async function liqConfig(): Promise<LiqConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = liqConfigSchema.safeParse(raw);
  return p.success ? p.data : liqConfigSchema.parse({});
}

export async function saveLiqConfig(c: Partial<LiqConfig>) {
  const value = JSON.stringify(liqConfigSchema.parse({ ...(await liqConfig()), ...c }));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export const INTERVALS = { EINMALIG: "einmalig", WOECHENTLICH: "wöchentlich", MONATLICH: "monatlich", QUARTALSWEISE: "vierteljährlich", JAEHRLICH: "jährlich" } as const;
export type Interval = keyof typeof INTERVALS;
export const INTERVAL_KEYS = Object.keys(INTERVALS) as [Interval, ...Interval[]];

export type CashFlow = { day: string; cents: number; label: string; kind: "rechnung" | "ausgabe" | "spesen" | "plan"; url?: string; overdue?: boolean };
export type Week = { start: string; end: string; inCents: number; outCents: number; balanceCents: number; items: CashFlow[] };

const ymd = (d: Date) => berlinParts(d).ymd;
const weekdayIdx = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const mondayOf = (day: string) => addDaysYmd(day, -((weekdayIdx(day) + 6) % 7));

function addMonthsYmd(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Termine einer geplanten Zahlung im Zeitraum */
export function occurrences(item: { interval: string; startDate: Date; endDate: Date | null }, from: string, to: string) {
  const start = ymd(item.startDate), end = item.endDate ? ymd(item.endDate) : null;
  const out: string[] = [];
  const step = (day: string, k: number) =>
    item.interval === "WOECHENTLICH" ? addDaysYmd(start, 7 * k) : item.interval === "MONATLICH" ? addMonthsYmd(start, k) : item.interval === "QUARTALSWEISE" ? addMonthsYmd(start, 3 * k) : item.interval === "JAEHRLICH" ? addMonthsYmd(start, 12 * k) : day;
  if (item.interval === "EINMALIG") return start >= from && start <= to && (!end || start <= end) ? [start] : [];
  for (let k = 0; k < 600; k++) {
    const d = step(start, k);
    if (d > to || (end && d > end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Aktueller Kontostand: Eingabe + Bankumsätze nach dem Stichtag */
export async function currentBalance(cfg?: LiqConfig) {
  const c = cfg ?? (await liqConfig());
  if (c.balanceCents === null || !c.asOf) return { known: false as const, cents: 0, asOf: null, bankCents: 0, bankCount: 0, lastBankDay: null as string | null };
  const after = await db.bankTx.aggregate({ where: { day: { gt: berlinDateTime(c.asOf, "23:59") }, ignored: false }, _sum: { amountCents: true }, _count: true, _max: { day: true } });
  const bank = after._sum.amountCents ?? 0;
  return { known: true as const, cents: c.balanceCents + bank, asOf: c.asOf, bankCents: bank, bankCount: after._count, lastBankDay: after._max.day ? ymd(after._max.day) : null };
}

export async function forecast(opts: { weeks?: number } = {}) {
  const cfg = await liqConfig();
  const nWeeks = opts.weeks ?? cfg.weeks;
  const today = todayYmd();
  const first = mondayOf(today);
  const last = addDaysYmd(first, nWeeks * 7 - 1);
  const [bal, invoices, purchases, expenses, plans] = await Promise.all([
    currentBalance(cfg),
    db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN" }, include: { customer: { select: { name: true } } } }),
    db.purchaseDoc.findMany({ where: { status: "OFFEN" } }),
    db.expense.findMany({ where: { status: "GENEHMIGT", paidAt: null }, include: { user: { select: { name: true } } } }),
    db.cashItem.findMany({ where: { active: true }, orderBy: { startDate: "asc" } }),
  ]);
  const flows: CashFlow[] = [];
  for (const d of invoices) {
    const open = openCentsOf(d);
    if (open <= 0) continue;
    const due = d.dueDate ? ymd(d.dueDate) : addDaysYmd(ymd(d.date), d.paymentDays ?? 14);
    flows.push({ day: due < today ? today : due, cents: open, label: `${d.number ?? "Rechnung"} · ${customerName(d)}${due < today ? ` (überfällig seit ${formatDate(berlinDateTime(due))})` : ""}`, kind: "rechnung", url: `/buchhaltung/beleg/${d.id}`, overdue: due < today });
  }
  for (const p of purchases) {
    const due = p.dueDate ? ymd(p.dueDate) : addDaysYmd(ymd(p.date), 14);
    flows.push({ day: due < today ? today : due, cents: -p.grossCents, label: `${p.supplier}${p.docNo ? ` ${p.docNo}` : ""}${due < today ? " (überfällig)" : ""}`, kind: "ausgabe", url: `/buchhaltung/ausgaben/${p.id}`, overdue: due < today });
  }
  if (expenses.length) {
    const byUser = new Map<string, number>();
    for (const e of expenses) byUser.set(e.user.name, (byUser.get(e.user.name) ?? 0) + e.amountCents);
    for (const [name, c] of byUser) flows.push({ day: today, cents: -c, label: `Spesen ${name} (genehmigt, nicht ausgezahlt)`, kind: "spesen", url: "/spesen" });
  }
  for (const it of plans) for (const day of occurrences(it, today, last)) flows.push({ day, cents: it.amountCents, label: it.name, kind: "plan" });

  let balance = bal.cents;
  const weeks: Week[] = [];
  for (let w = 0; w < nWeeks; w++) {
    const start = addDaysYmd(first, w * 7), end = addDaysYmd(start, 6);
    const items = flows.filter((f) => f.day >= start && f.day <= end).sort((a, b) => a.day.localeCompare(b.day) || b.cents - a.cents);
    const inCents = items.filter((f) => f.cents > 0).reduce((s, f) => s + f.cents, 0);
    const outCents = items.filter((f) => f.cents < 0).reduce((s, f) => s - f.cents, 0);
    balance += inCents - outCents;
    weeks.push({ start, end, inCents, outCents, balanceCents: balance, items });
  }
  const lowest = weeks.reduce((m, w) => (w.balanceCents < m.balanceCents ? w : m), weeks[0]);
  const belowReserve = weeks.find((w) => w.balanceCents < cfg.reserveCents) ?? null;
  const negative = weeks.find((w) => w.balanceCents < 0) ?? null;
  const later = flows.filter((f) => f.day > last);
  return {
    cfg,
    balance: bal,
    weeks,
    lowest,
    belowReserve,
    negative,
    overdueIn: flows.filter((f) => f.overdue && f.cents > 0).reduce((s, f) => s + f.cents, 0),
    overdueOut: flows.filter((f) => f.overdue && f.cents < 0).reduce((s, f) => s - f.cents, 0),
    totalIn: weeks.reduce((s, w) => s + w.inCents, 0),
    totalOut: weeks.reduce((s, w) => s + w.outCents, 0),
    laterIn: later.filter((f) => f.cents > 0).reduce((s, f) => s + f.cents, 0),
    plans,
  };
}

/** Kurzfassung für Jarvis */
export async function forecastText(weeks?: number) {
  const f = await forecast({ weeks });
  const fmtW = (w: Week) => `KW ${isoWeek(w.start)} (${formatDate(berlinDateTime(w.start))})`;
  const lines = [
    f.balance.known ? `Kontostand jetzt (geschätzt): ${fmtEuroCents(f.balance.cents)} – Eingabe ${fmtEuroCents(f.cfg.balanceCents)} am ${formatDate(berlinDateTime(f.balance.asOf!))}${f.balance.bankCount ? ` + ${f.balance.bankCount} Bankumsätze danach (${fmtEuroCents(f.balance.bankCents)})` : ""}.` : "Kein Kontostand hinterlegt – Vorschau startet bei 0 €. Kontostand unter [Liquidität](/buchhaltung/liquiditaet) eintragen.",
    `Nächste ${f.weeks.length} Wochen: Eingänge ${fmtEuroCents(f.totalIn)}, Ausgänge ${fmtEuroCents(f.totalOut)}, Stand am Ende ${fmtEuroCents(f.weeks.at(-1)?.balanceCents ?? 0)}.`,
    `Tiefster Stand: ${fmtEuroCents(f.lowest.balanceCents)} in ${fmtW(f.lowest)}.`,
    f.negative ? `⚠️ Konto rutscht ins Minus in ${fmtW(f.negative)}.` : f.belowReserve ? `⚠️ Unter der Reserve von ${fmtEuroCents(f.cfg.reserveCents)} in ${fmtW(f.belowReserve)}.` : `Reserve von ${fmtEuroCents(f.cfg.reserveCents)} wird gehalten.`,
    f.overdueIn ? `Überfällige Kundenrechnungen: ${fmtEuroCents(f.overdueIn)} (in dieser Woche eingeplant – nachfassen/mahnen).` : null,
    f.overdueOut ? `Überfällige eigene Rechnungen: ${fmtEuroCents(f.overdueOut)}.` : null,
    "Wochen:",
    ...f.weeks.map((w) => `- ${fmtW(w)}: +${fmtEuroCents(w.inCents)} / −${fmtEuroCents(w.outCents)} → ${fmtEuroCents(w.balanceCents)}${w.items.length ? ` (${w.items.slice(0, 3).map((i) => i.label).join("; ")}${w.items.length > 3 ? " …" : ""})` : ""}`),
    "Enthalten: offene Rechnungen, offene Ausgaben, genehmigte Spesen, geplante Zahlungen. Nicht enthalten: Angebote/Aufträge ohne Rechnung, Bestellungen ohne Eingangsrechnung. [Liquidität](/buchhaltung/liquiditaet)",
  ];
  return lines.filter(Boolean).join("\n");
}

export function isoWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400_000 + 1) / 7);
}
