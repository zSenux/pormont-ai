"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth/user";
import { ABS_KINDS } from "@/lib/abwesenheit-shared";
import { AbsenceError, cancelAbsence, decideAbsence, requestAbsence } from "@/lib/abwesenheit";

// Server-Actions für Urlaub & Krank (jeder für sich; Genehmigen, für andere eintragen und Urlaubsanspruch nur Admin)

type Result = { error?: string; ok?: string };
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const done = () => {
  revalidatePath("/abwesenheiten");
  revalidatePath("/kalender");
  revalidatePath("/stunden");
  revalidatePath("/");
};

export async function newAbsence(_prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireUser();
  const p = z
    .object({ kind: z.enum(ABS_KINDS), from: ymd, to: ymd.optional(), halfDay: z.boolean(), note: z.string().trim().max(500).optional(), userId: z.cuid().optional(), certificate: z.boolean() })
    .safeParse({ kind: form.get("kind"), from: opt(form.get("from")), to: opt(form.get("to")), halfDay: form.get("halfDay") === "on", note: opt(form.get("note")), userId: opt(form.get("userId")), certificate: form.get("certificate") === "on" });
  if (!p.success) return { error: "Bitte Art und Datum angeben." };
  try {
    const a = await requestAbsence({ ...p.data, to: p.data.to ?? p.data.from, userId: p.data.userId ?? u.id }, u);
    done();
    return { ok: a.status === "GENEHMIGT" ? (a.kind === "KRANK" ? "Krankmeldung eingetragen – gute Besserung!" : "Eingetragen und genehmigt.") : "Antrag gestellt – du bekommst Bescheid, sobald er entschieden ist." };
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
}

export async function approveAbsence(id: string) {
  const u = await requireAdmin();
  try {
    await decideAbsence(z.cuid().parse(id), true, null, u);
  } catch (e) {
    if (!(e instanceof AbsenceError)) throw e;
  }
  done();
}

export async function rejectAbsence(id: string, form: FormData) {
  const u = await requireAdmin();
  const note = z.string().trim().max(300).optional().parse(opt(form.get("note")));
  try {
    await decideAbsence(z.cuid().parse(id), false, note ?? null, u);
  } catch (e) {
    if (!(e instanceof AbsenceError)) throw e;
  }
  done();
}

export async function cancelAbsenceAction(id: string) {
  const u = await requireUser();
  try {
    await cancelAbsence(z.cuid().parse(id), u);
  } catch (e) {
    if (e instanceof AbsenceError) return { error: e.message };
    throw e;
  }
  done();
}

export async function setCertificate(id: string) {
  await requireAdmin();
  const a = await db.absence.findUnique({ where: { id: z.cuid().parse(id) }, select: { certificate: true } });
  if (a) await db.absence.update({ where: { id }, data: { certificate: !a.certificate } });
  done();
}

export async function setVacationDays(userId: string, form: FormData) {
  await requireAdmin();
  const v = opt(form.get("days"));
  const n = v === undefined ? null : z.coerce.number().int().min(0).max(60).parse(v);
  await db.user.update({ where: { id: z.cuid().parse(userId) }, data: { vacationDays: n } });
  done();
}
