import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinParts, todayYmd } from "@/lib/berlin";
import { absenceCovers, absencesBetween } from "@/lib/abwesenheit";
import { daysBetween, isWorkday, weekdayOf } from "@/lib/abwesenheit-shared";
import { readLines, lineNetCents } from "@/lib/buchhaltung/money";
import { defaultHourlyRate } from "@/lib/nachkalkulation";

// Kapazitätsplanung Werkstatt: Wochen-Kapazität des Werkstatt-Teams (Arbeitstage ohne Feiertage BW,
// minus genehmigte Abwesenheiten) gegen die Plan-Stunden der offenen Fertigungskarten.
// Karten werden gleichmäßig auf die Arbeitstage zwischen Plan-Start und Plan-Ende verteilt; Tage in der
// Vergangenheit gelten als erledigt, überfällige Reste landen in der aktuellen Woche.
// „Passt das rein?“ füllt die freie Kapazität ab heute Woche für Woche auf.

const KEY = "KAPAZITAET";
export const capConfigSchema = z.object({
  /** Werkstatt-Team; leer = alle mit Funktion Fertigung (sonst alle, denen Karten zugeteilt sind) */
  userIds: z.array(z.string()).max(100).default([]),
  hoursPerDay: z.number().min(1).max(12).default(8),
  /** Anteil produktiver Stunden (Rüsten, Aufräumen, Wege abgezogen) */
  productivePct: z.number().min(30).max(100).default(85),
});
export type CapConfig = z.infer<typeof capConfigSchema>;

export async function capConfig(): Promise<CapConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  try {
    return capConfigSchema.parse(row ? JSON.parse(row.value) : {});
  } catch {
    return capConfigSchema.parse({});
  }
}
export async function saveCapConfig(c: CapConfig) {
  const value = JSON.stringify(capConfigSchema.parse(c));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export const mondayOf = (ymd: string) => addDaysYmd(ymd, -((weekdayOf(ymd) + 6) % 7));
/** ISO-Kalenderwoche */
export function isoWeek(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - first.getTime()) / 86400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

export async function workshopTeam(cfg?: CapConfig) {
  const c = cfg ?? (await capConfig());
  if (c.userIds.length) return db.user.findMany({ where: { id: { in: c.userIds } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const f = await db.user.findMany({ where: { funktion: "FERTIGUNG" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  if (f.length) return f;
  return db.user.findMany({ where: { productionJobs: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

type Week = { start: string; end: string; kw: number; capacity: number; load: number; free: number; pct: number; people: Record<string, { capacity: number; load: number }>; unassigned: number; absences: string[] };

/** Kapazität und Auslastung für `count` Wochen ab der aktuellen Woche */
export async function capacityWeeks(count = 8) {
  const cfg = await capConfig();
  const team = await workshopTeam(cfg);
  const teamIds = new Set(team.map((u) => u.id));
  const today = todayYmd();
  const first = mondayOf(today);
  const last = addDaysYmd(first, count * 7 - 1);
  const perDay = cfg.hoursPerDay * (cfg.productivePct / 100);
  const [abs, jobs] = await Promise.all([
    absencesBetween(first, last, { approvedOnly: true }),
    db.productionJob.findMany({
      where: { status: { notIn: ["FERTIG", "MONTAGEBEREIT"] } },
      select: { id: true, number: true, title: true, status: true, plannedHours: true, plannedStart: true, plannedEnd: true, assigneeId: true, assignee: { select: { name: true } }, project: { select: { name: true } } },
    }),
  ]);
  const weeks: Week[] = Array.from({ length: count }, (_, i) => {
    const start = addDaysYmd(first, i * 7);
    return { start, end: addDaysYmd(start, 6), kw: isoWeek(start), capacity: 0, load: 0, free: 0, pct: 0, people: Object.fromEntries(team.map((u) => [u.id, { capacity: 0, load: 0 }])), unassigned: 0, absences: [] };
  });
  const weekOf = (ymd: string) => weeks.find((w) => w.start <= ymd && ymd <= w.end);

  // Kapazität: ab heute, je Mitarbeiter und Arbeitstag, Abwesenheit abziehen
  for (const w of weeks) {
    for (const d of daysBetween(w.start, w.end)) {
      if (d < today || !isWorkday(d)) continue;
      for (const u of team) {
        const a = abs.find((x) => x.userId === u.id && absenceCovers(x, d));
        const h = a ? (a.halfDay ? perDay / 2 : 0) : perDay;
        w.people[u.id].capacity += h;
        w.capacity += h;
        if (a && !w.absences.includes(u.name)) w.absences.push(u.name);
      }
    }
  }

  // Auslastung aus den Fertigungskarten
  const unplanned: typeof jobs = [];
  const overdue: typeof jobs = [];
  for (const j of jobs) {
    const h = j.plannedHours ?? 0;
    if (h <= 0 || j.status === "QK") continue;
    if (!j.plannedStart && !j.plannedEnd) {
      unplanned.push(j);
      continue;
    }
    const s = j.plannedStart ? berlinParts(j.plannedStart).ymd : null;
    const e = j.plannedEnd ? berlinParts(j.plannedEnd).ymd : null;
    const start = s ?? (e && e > today ? today : e!);
    const end = e ?? addDaysYmd(s!, Math.max(0, Math.ceil(h / Math.max(1, perDay)) - 1) + 2);
    const days = daysBetween(start <= end ? start : end, end).filter(isWorkday);
    const perWorkday = h / Math.max(1, days.length);
    let rest = 0;
    const add = (d: string, x: number) => {
      const w = weekOf(d);
      if (!w) return;
      w.load += x;
      if (j.assigneeId && teamIds.has(j.assigneeId)) w.people[j.assigneeId].load += x;
      else w.unassigned += x;
    };
    for (const d of days) {
      if (d < today) rest += perWorkday;
      else add(d, perWorkday);
    }
    // Plan-Ende überschritten: Rest gilt als noch offen (in Arbeit: zur Hälfte) → diese Woche
    if (e && e < today) {
      overdue.push(j);
      add(today, (j.status === "IN_FERTIGUNG" ? 0.5 : 1) * (days.length ? rest : h));
    }
  }
  for (const w of weeks) {
    w.free = w.capacity - w.load;
    w.pct = w.capacity > 0 ? (w.load / w.capacity) * 100 : w.load > 0 ? 999 : 0;
  }
  return { cfg, team, weeks, unplanned, overdue, unplannedHours: unplanned.reduce((t, j) => t + (j.plannedHours ?? 0), 0) };
}

/** Passt ein neuer Auftrag mit `hours` Werkstattstunden rein? Optional fertig bis `by` (JJJJ-MM-TT). */
export async function fitCheck(hours: number, by?: string | null, opts: { includeUnplanned?: boolean } = {}) {
  const r = await capacityWeeks(26);
  let need = hours + (opts.includeUnplanned ? r.unplannedHours : 0);
  let finish: (typeof r.weeks)[number] | null = null;
  const used: { kw: number; start: string; hours: number }[] = [];
  for (const w of r.weeks) {
    const take = Math.min(Math.max(0, w.free), need);
    if (take >= 0.5) used.push({ kw: w.kw, start: w.start, hours: take });
    need -= take;
    if (need <= 0.5) {
      finish = w;
      break;
    }
  }
  const ok = Boolean(finish && (!by || finish.start <= by));
  return { hours, by: by ?? null, finish, used, ok, weeks: r.weeks, cfg: r.cfg, team: r.team, unplannedHours: r.unplannedHours };
}

/** Werkstattstunden aus einem Angebot: Positionen mit Einheit Std./h, sonst Schätzung über den Lohnanteil */
export async function hoursFromQuote(docId: string) {
  const d = await db.salesDoc.findUnique({ where: { id: docId }, select: { id: true, number: true, title: true, netCents: true, lines: true, kind: true } });
  if (!d) return null;
  const lines = readLines(d.lines);
  const hourLines = lines.filter((l) => /^(std|stunde|h\b|std\.)/i.test(l.unit.trim()));
  if (hourLines.length) return { doc: d, hours: hourLines.reduce((t, l) => t + l.qty, 0), estimated: false };
  // Schätzung: 40 % des Netto-Werts sind Lohn, geteilt durch den Kalkulations-Stundensatz
  const net = lines.reduce((t, l) => t + lineNetCents(l), 0) / 100 || d.netCents / 100;
  return { doc: d, hours: Math.round(((net * 0.4) / defaultHourlyRate()) * 2) / 2, estimated: true };
}

export const fmtH = (h: number) => `${Math.round(h).toLocaleString("de-DE")} Std.`;

/** Kurztext für Jarvis */
export function capacityText(r: Awaited<ReturnType<typeof capacityWeeks>>) {
  const lines = [`Werkstatt-Team: ${r.team.map((u) => u.name).join(", ") || "niemand festgelegt"} (${r.cfg.hoursPerDay} Std./Tag, ${r.cfg.productivePct} % produktiv).`];
  for (const w of r.weeks) lines.push(`- KW ${w.kw} (ab ${w.start.slice(8)}.${w.start.slice(5, 7)}.): ${fmtH(w.load)} geplant von ${fmtH(w.capacity)} → ${Math.round(w.pct)} %${w.pct > 100 ? " ⚠ überbucht" : ""}${w.absences.length ? ` · abwesend: ${w.absences.join(", ")}` : ""}`);
  if (r.unplanned.length) lines.push(`Ohne Termin: ${r.unplanned.length} Karten mit ${fmtH(r.unplannedHours)} (nicht eingerechnet).`);
  if (r.overdue.length) lines.push(`Überfällig: ${r.overdue.map((j) => j.number).join(", ")} (Rest in dieser Woche eingerechnet).`);
  lines.push("[Kapazität](/fertigung/kapazitaet)");
  return lines.join("\n");
}
