import "server-only";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDateTime } from "@/lib/berlin";

// Kalender von ProMont: Termine (optional mit Projekt/Baustelle), Push-Erinnerung vorher.

export const timeHm = (d: Date) => {
  const p = berlinParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

export function eventLine(e: { title: string; startAt: Date; endAt: Date | null; allDay: boolean; location: string | null; project?: { name: string } | null }) {
  const when = e.allDay ? `${formatDateTime(e.startAt).slice(0, 10)} ganztägig` : `${formatDateTime(e.startAt)}${e.endAt ? `–${timeHm(e.endAt)}` : ""}`;
  return `${when} · ${e.title}${e.location ? ` · ${e.location}` : ""}${e.project ? ` · Projekt ${e.project.name}` : ""}`;
}

/** Termine zwischen zwei Berliner Tagen (inkl.) */
export async function eventsBetween(fromYmd: string, toYmd: string, projectId?: string) {
  return db.event.findMany({
    where: { startAt: { gte: berlinDateTime(fromYmd), lt: berlinDateTime(addDaysYmd(toYmd, 1)) }, ...(projectId ? { projectId } : {}) },
    orderBy: { startAt: "asc" },
    include: { project: { select: { id: true, name: true } } },
  });
}

export async function todayEvents() {
  const t = berlinParts().ymd;
  return eventsBetween(t, t);
}
