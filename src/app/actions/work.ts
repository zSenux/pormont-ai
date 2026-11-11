"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { LexwareError } from "@/lib/lexware/client";
import { uploadReceipt } from "@/lib/receipts";
import { parseHours } from "@/lib/hours";

// Server-Actions für Kalender, Projekte/Baustellen, Stunden, Dateien und Belege.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);

// ---------- Kalender ----------
const eventForm = z.object({
  title: z.string().trim().min(1).max(200),
  date: ymd,
  from: hm.optional(),
  to: hm.optional(),
  location: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
  projectId: z.cuid().optional(),
  remind: z.coerce.number().int().min(0).max(1440).optional(),
});

export async function saveEvent(form: FormData) {
  const user = await requireUser();
  const id = opt(form.get("id"));
  const e = eventForm.parse({ title: form.get("title"), date: form.get("date"), from: opt(form.get("from")), to: opt(form.get("to")), location: opt(form.get("location")), notes: opt(form.get("notes")), projectId: opt(form.get("projectId")), remind: opt(form.get("remind")) });
  const allDay = !e.from;
  const startAt = berlinDateTime(e.date, e.from ?? "00:00");
  const endAt = e.to && e.from && e.to > e.from ? berlinDateTime(e.date, e.to) : null;
  const data = { title: e.title, startAt, endAt, allDay, location: e.location ?? null, notes: e.notes ?? null, projectId: e.projectId ?? null, remindMinutes: allDay ? null : (e.remind ?? 30), reminderSentAt: null };
  if (id) await db.event.update({ where: { id }, data });
  else await db.event.create({ data: { ...data, createdById: user.id } });
  revalidatePath("/kalender");
  if (e.projectId) revalidatePath(`/projekte/${e.projectId}`);
}

export async function deleteEvent(id: string) {
  await requireUser();
  await db.event.deleteMany({ where: { id: z.cuid().parse(id) } });
  revalidatePath("/kalender");
}

// ---------- Projekte / Baustellen ----------
const projectForm = z.object({
  name: z.string().trim().min(2).max(200),
  customer: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
});

export async function createProject(form: FormData) {
  const user = await requireUser();
  const p = projectForm.parse({ name: form.get("name"), customer: opt(form.get("customer")), address: opt(form.get("address")), description: opt(form.get("description")), startDate: opt(form.get("startDate")), endDate: opt(form.get("endDate")) });
  const created = await db.project.create({ data: { ...p, startDate: p.startDate ? berlinDateTime(p.startDate) : null, endDate: p.endDate ? berlinDateTime(p.endDate) : null, createdById: user.id } });
  redirect(`/projekte/${created.id}`);
}

export async function updateProject(id: string, form: FormData) {
  await requireUser();
  const p = projectForm.parse({ name: form.get("name"), customer: opt(form.get("customer")), address: opt(form.get("address")), description: opt(form.get("description")), startDate: opt(form.get("startDate")), endDate: opt(form.get("endDate")) });
  await db.project.update({ where: { id: z.cuid().parse(id) }, data: { name: p.name, customer: p.customer ?? null, address: p.address ?? null, description: p.description ?? null, startDate: p.startDate ? berlinDateTime(p.startDate) : null, endDate: p.endDate ? berlinDateTime(p.endDate) : null } });
  revalidatePath(`/projekte/${id}`);
}

export async function setProjectStatus(id: string, status: string) {
  await requireUser();
  await db.project.update({ where: { id: z.cuid().parse(id) }, data: { status: z.enum(["PLANUNG", "LAEUFT", "PAUSIERT", "FERTIG"]).parse(status) } });
  revalidatePath(`/projekte/${id}`);
  revalidatePath("/projekte");
}

export async function deleteNote(id: string) {
  await requireUser();
  const n = await db.projectNote.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!n) return;
  await db.projectNote.delete({ where: { id: n.id } });
  if (n.fileId) await db.storedFile.deleteMany({ where: { id: n.fileId } });
  revalidatePath(`/projekte/${n.projectId}`);
}

// ---------- Stunden ----------
export async function addTime(form: FormData) {
  const user = await requireUser();
  const t = z.object({ projectId: z.cuid(), day: ymd, hours: z.string().trim().max(10), note: z.string().trim().max(500).optional(), userId: z.cuid().optional() }).parse({ projectId: form.get("projectId"), day: form.get("day"), hours: form.get("hours"), note: opt(form.get("note")), userId: opt(form.get("userId")) });
  const minutes = parseHours(t.hours);
  if (!minutes) throw new Error("Bitte Stunden angeben, z. B. 7,5 oder 7:30.");
  // Nur Administratoren tragen für andere ein
  const forUser = user.role === "ADMIN" && t.userId ? t.userId : user.id;
  await db.timeEntry.create({ data: { projectId: t.projectId, userId: forUser, day: berlinDateTime(t.day), minutes, note: t.note ?? null } });
  revalidatePath(`/projekte/${t.projectId}`);
  revalidatePath("/stunden");
}

export async function deleteTime(id: string) {
  const user = await requireUser();
  const t = await db.timeEntry.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!t || (t.userId !== user.id && user.role !== "ADMIN")) return;
  await db.timeEntry.delete({ where: { id: t.id } });
  revalidatePath("/stunden");
  if (t.projectId) revalidatePath(`/projekte/${t.projectId}`);
}

// ---------- Dateien ----------
export async function deleteFile(id: string) {
  await requireUser();
  const f = await db.storedFile.findUnique({ where: { id: z.cuid().parse(id) }, select: { id: true, projectId: true } });
  if (!f) return;
  await db.projectNote.deleteMany({ where: { fileId: f.id, text: null } });
  await db.storedFile.delete({ where: { id: f.id } });
  revalidatePath("/dokumente");
  revalidatePath("/belege/foto");
  if (f.projectId) revalidatePath(`/projekte/${f.projectId}`);
}

export async function assignFile(id: string, projectId: string | null) {
  await requireUser();
  await db.storedFile.update({ where: { id: z.cuid().parse(id) }, data: { projectId: projectId ? z.cuid().parse(projectId) : null } });
  revalidatePath("/dokumente");
}

// ---------- Belege ----------
/** Der Klick auf „In Lexware hochladen“ ist die Freigabe durch einen Menschen */
export async function sendReceiptToLexware(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  try {
    await uploadReceipt(z.cuid().parse(id));
    revalidatePath("/belege/foto");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof LexwareError ? e.message : "Hochladen fehlgeschlagen." };
  }
}
