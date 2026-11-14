"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { setPhase } from "@/lib/phases";
import { PHASE_KEYS, PHASE_STATUSES, PRIORITIES } from "@/lib/phases-shared";

// Server-Actions fürs Projektmanagement: Phasen, Meilensteine, Projektleiter/Team, Projektaufgaben.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const done = (projectId: string) => {
  revalidatePath(`/projekte/${projectId}`);
  revalidatePath("/projekte");
  revalidatePath("/");
};

export async function setPhaseStatus(projectId: string, key: string, status: string) {
  const u = await requireUser();
  const id = z.cuid().parse(projectId);
  await setPhase({ projectId: id, key: z.enum(PHASE_KEYS).parse(key), status: z.enum(PHASE_STATUSES).parse(status), userName: u.name });
  done(id);
}

export async function savePhase(projectId: string, key: string, form: FormData) {
  const u = await requireUser();
  const id = z.cuid().parse(projectId);
  const p = z.object({ start: ymd.optional(), ende: ymd.optional(), note: z.string().trim().max(1000).optional() }).parse({ start: opt(form.get("start")), ende: opt(form.get("ende")), note: opt(form.get("note")) });
  await setPhase({ projectId: id, key: z.enum(PHASE_KEYS).parse(key), start: p.start ?? null, ende: p.ende ?? null, note: p.note ?? null, userName: u.name });
  done(id);
}

export async function addMilestone(projectId: string, form: FormData) {
  await requireUser();
  const id = z.cuid().parse(projectId);
  const m = z.object({ title: z.string().trim().min(2).max(200), date: ymd.optional() }).parse({ title: form.get("title"), date: opt(form.get("date")) });
  await db.projectMilestone.create({ data: { projectId: id, title: m.title, dueDate: m.date ? berlinDateTime(m.date) : null } });
  done(id);
}

export async function toggleMilestone(id: string) {
  await requireUser();
  const m = await db.projectMilestone.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!m) return;
  await db.projectMilestone.update({ where: { id: m.id }, data: { doneAt: m.doneAt ? null : new Date() } });
  done(m.projectId);
}

export async function deleteMilestone(id: string) {
  await requireUser();
  const m = await db.projectMilestone.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!m) return;
  await db.projectMilestone.delete({ where: { id: m.id } });
  done(m.projectId);
}

export async function setLeader(projectId: string, form: FormData) {
  await requireUser();
  const id = z.cuid().parse(projectId);
  const leaderId = opt(form.get("leaderId"));
  await db.project.update({ where: { id }, data: { leaderId: leaderId ? z.cuid().parse(leaderId) : null } });
  done(id);
}

export async function addMember(projectId: string, form: FormData) {
  await requireUser();
  const id = z.cuid().parse(projectId);
  const m = z.object({ userId: z.cuid(), role: z.string().trim().max(60).optional() }).parse({ userId: form.get("userId"), role: opt(form.get("role")) });
  await db.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: m.userId } }, create: { projectId: id, userId: m.userId, role: m.role ?? null }, update: { role: m.role ?? null } });
  done(id);
}

export async function removeMember(id: string) {
  await requireUser();
  const m = await db.projectMember.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!m) return;
  await db.projectMember.delete({ where: { id: m.id } });
  done(m.projectId);
}

export async function addProjectTask(projectId: string, form: FormData) {
  const u = await requireUser();
  const id = z.cuid().parse(projectId);
  const t = z
    .object({ title: z.string().trim().min(1).max(300), date: ymd.optional(), assigneeId: z.cuid().optional(), priority: z.enum(PRIORITIES).default("NORMAL") })
    .parse({ title: form.get("title"), date: opt(form.get("date")), assigneeId: opt(form.get("assigneeId")), priority: opt(form.get("priority")) });
  await db.task.create({ data: { title: t.title, dueAt: t.date ? berlinDateTime(t.date) : null, projectId: id, assigneeId: t.assigneeId ?? null, priority: t.priority, createdById: u.id } });
  done(id);
  revalidatePath("/aufgaben");
}
