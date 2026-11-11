import "server-only";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts } from "@/lib/berlin";

// Arbeitszeit der Mitarbeiter: Stempeluhr (Kommen/Gehen) und nachgetragene Stunden – alles in TimeEntry.

export const TIME_KINDS = ["ARBEIT", "FAHRT", "URLAUB", "KRANK", "FEIERTAG"] as const;
export type TimeKind = (typeof TIME_KINDS)[number];
export const TIME_KIND_LABEL: Record<TimeKind, string> = { ARBEIT: "Arbeit", FAHRT: "Fahrtzeit", URLAUB: "Urlaub", KRANK: "Krank", FEIERTAG: "Feiertag" };

/** Gesetzliche Mindestpause (§ 4 ArbZG): > 6 Std. 30 min, > 9 Std. 45 min */
export function legalPause(grossMin: number) {
  return grossMin > 9 * 60 ? 45 : grossMin > 6 * 60 ? 30 : 0;
}

/** Netto-Minuten aus Kommen/Gehen; Pause mindestens gesetzlich */
export function netMinutes(start: Date, end: Date, pauseMin: number) {
  const gross = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const pause = Math.max(pauseMin, legalPause(gross));
  return { gross, pause, net: Math.max(0, gross - pause) };
}

export function runningEntry(userId: string) {
  return db.timeEntry.findFirst({ where: { userId, startAt: { not: null }, endAt: null }, include: { project: { select: { id: true, name: true } } } });
}

/** Montag der Woche (JJJJ-MM-TT) zu einem Tag */
export function weekStart(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysYmd(ymd, -wd);
}

/** Monatsgrenzen (UTC-Zeitpunkte) zu „JJJJ-MM“ */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: berlinDateTime(`${month}-01`), to: berlinDateTime(`${next}-01`), next, prev: m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}` };
}

export const thisMonth = () => berlinParts().ymd.slice(0, 7);
export const monthLabel = (month: string) => new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
