"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, berlinParts, todayYmd } from "@/lib/berlin";
import { parseHours } from "@/lib/hours";
import { netMinutes, runningEntry, TIME_KINDS } from "@/lib/zeiten";

// Arbeitszeit: Stempeluhr und Nachtragen

const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
type Result = { ok?: string; error?: string } | undefined;

function refresh(projectId?: string | null) {
  revalidatePath("/stunden");
  revalidatePath("/");
  if (projectId) revalidatePath(`/projekte/${projectId}`);
}

export async function clockIn(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: z.cuid().optional(), note: z.string().trim().max(500).optional() }).safeParse({ projectId: opt(form.get("projectId")), note: opt(form.get("note")) });
  if (!p.success) return { error: "Eingabe ungültig." };
  if (await runningEntry(user.id)) return { error: "Du bist schon eingestempelt." };
  await db.timeEntry.create({ data: { userId: user.id, projectId: p.data.projectId ?? null, day: berlinDateTime(todayYmd()), minutes: 0, startAt: new Date(), note: p.data.note ?? null } });
  refresh(p.data.projectId);
  return { ok: "Eingestempelt." };
}

export async function clockOut(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const pause = z.coerce.number().int().min(0).max(480).catch(0).parse(opt(form.get("pause")) ?? 0);
  const run = await runningEntry(user.id);
  if (!run?.startAt) return { error: "Du bist nicht eingestempelt." };
  const end = new Date();
  const m = netMinutes(run.startAt, end, pause);
  const note = opt(form.get("note"));
  await db.timeEntry.update({ where: { id: run.id }, data: { endAt: end, pauseMin: m.pause, minutes: m.net, ...(note ? { note } : {}) } });
  refresh(run.projectId);
  return { ok: `Ausgestempelt: ${(m.net / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Std.${m.pause > pause ? ` (gesetzliche Pause ${m.pause} min abgezogen)` : ""}` };
}

/** Zeit nachtragen: entweder Von–Bis (+ Pause) oder Stunden */
export async function addWorkTime(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const hm = z.string().regex(/^\d{2}:\d{2}$/);
  const p = z
    .object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      from: hm.optional(),
      to: hm.optional(),
      pause: z.coerce.number().int().min(0).max(480).optional(),
      hours: z.string().max(10).optional(),
      kind: z.enum(TIME_KINDS).default("ARBEIT"),
      projectId: z.cuid().optional(),
      note: z.string().trim().max(500).optional(),
      userId: z.cuid().optional(),
    })
    .safeParse(Object.fromEntries(["day", "from", "to", "pause", "hours", "kind", "projectId", "note", "userId"].map((k) => [k, opt(form.get(k))])));
  if (!p.success) return { error: "Bitte Tag und Zeit prüfen." };
  const t = p.data;
  if (t.day > todayYmd()) return { error: "Zukünftige Tage gehen nicht." };
  let data: { minutes: number; startAt?: Date; endAt?: Date; pauseMin?: number };
  if (t.from && t.to) {
    if (t.to <= t.from) return { error: "„Bis“ muss nach „Von“ liegen." };
    const s = berlinDateTime(t.day, t.from);
    const e = berlinDateTime(t.day, t.to);
    const m = netMinutes(s, e, t.pause ?? 0);
    data = { minutes: m.net, startAt: s, endAt: e, pauseMin: m.pause };
  } else {
    const minutes = parseHours(t.hours ?? "");
    if (!minutes) return { error: "Von/Bis oder Stunden angeben, z. B. 8 oder 7:30." };
    data = { minutes };
  }
  // Nur Administratoren tragen für andere ein
  const forUser = user.role === "ADMIN" && t.userId ? t.userId : user.id;
  await db.timeEntry.create({ data: { ...data, userId: forUser, day: berlinDateTime(t.day), kind: t.kind, projectId: t.projectId ?? null, note: t.note ?? null } });
  refresh(t.projectId);
  return { ok: "Eingetragen." };
}

export async function deleteWorkTime(id: string) {
  const user = await requireUser();
  const t = await db.timeEntry.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!t || (t.userId !== user.id && user.role !== "ADMIN")) return;
  // Eigene Einträge nur im laufenden Monat löschen (danach ist der Monat abgerechnet)
  if (user.role !== "ADMIN" && berlinParts(t.day).ymd.slice(0, 7) !== todayYmd().slice(0, 7)) return;
  await db.timeEntry.delete({ where: { id: t.id } });
  refresh(t.projectId);
}
