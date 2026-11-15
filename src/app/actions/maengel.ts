"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { berlinDateTime } from "@/lib/berlin";
import { assignDefect, createDefect, DefectError, setDefectStatus } from "@/lib/maengel";
import { DEFECT_STATUSES, SEVERITIES, SOURCES } from "@/lib/maengel-shared";

// Server-Actions Mängelmanagement (Bereich Projekte – Monteure, Werkstatt, Projektleitung)

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const refresh = (id?: string, projectId?: string) => {
  revalidatePath("/maengel");
  if (id) revalidatePath(`/maengel/${id}`);
  if (projectId) revalidatePath(`/projekte/${projectId}`);
  revalidatePath("/");
};

export async function newDefect(_prev: Result, form: FormData): Promise<Result> {
  const u = await requireArea("projekte");
  const p = z
    .object({ projectId: z.cuid(), title: z.string().trim().min(3).max(200), description: z.string().trim().max(4000).optional(), location: z.string().trim().max(200).optional(), severity: z.enum(SEVERITIES), source: z.enum(SOURCES).optional(), assigneeId: z.cuid().optional(), dueDate: ymd.optional() })
    .safeParse({ projectId: form.get("projectId"), title: form.get("title"), description: opt(form.get("description")), location: opt(form.get("location")), severity: form.get("severity") ?? "MITTEL", source: opt(form.get("source")), assigneeId: opt(form.get("assigneeId")), dueDate: opt(form.get("dueDate")) });
  if (!p.success) return { error: "Bitte Projekt und eine kurze Beschreibung (mind. 3 Zeichen) angeben." };
  let id: string;
  try {
    id = (await createDefect(p.data, u)).id;
  } catch (e) {
    if (e instanceof DefectError) return { error: e.message };
    throw e;
  }
  refresh(id, p.data.projectId);
  redirect(`/maengel/${id}?neu=1`);
}

export async function changeDefectStatus(id: string, status: string, form?: FormData) {
  const u = await requireArea("projekte");
  const note = form ? z.string().trim().max(2000).optional().parse(opt(form.get("note"))) : undefined;
  try {
    const d = await setDefectStatus(z.cuid().parse(id), z.enum(DEFECT_STATUSES).parse(status), note ?? null, u);
    refresh(d.id, d.projectId);
  } catch (e) {
    if (!(e instanceof DefectError)) throw e;
  }
}

export async function updateDefectAssign(id: string, form: FormData) {
  const u = await requireArea("projekte");
  const assigneeId = z.cuid().optional().parse(opt(form.get("assigneeId")));
  const due = ymd.optional().parse(opt(form.get("dueDate")));
  const d = await assignDefect(z.cuid().parse(id), assigneeId ?? null, due ?? null, u);
  refresh(d.id, d.projectId);
}

export async function editDefect(id: string, form: FormData) {
  await requireArea("projekte");
  const p = z
    .object({ title: z.string().trim().min(3).max(200), description: z.string().trim().max(4000).optional(), location: z.string().trim().max(200).optional(), severity: z.enum(SEVERITIES), source: z.enum(SOURCES), warranty: z.boolean(), cost: z.string().optional() })
    .parse({ title: form.get("title"), description: opt(form.get("description")), location: opt(form.get("location")), severity: form.get("severity"), source: form.get("source"), warranty: form.get("warranty") === "on", cost: opt(form.get("cost")) });
  const cost = p.cost ? Math.round(Number(p.cost.replace(/\./g, "").replace(",", ".")) * 100) : null;
  const d = await db.defect.update({ where: { id: z.cuid().parse(id) }, data: { title: p.title, description: p.description ?? null, location: p.location ?? null, severity: p.severity, source: p.source, warranty: p.warranty, costCents: cost !== null && Number.isFinite(cost) ? cost : null } });
  refresh(d.id, d.projectId);
}

/** Gewährleistung eines Projekts von Hand setzen (leer = aus der Abnahme) */
export async function setWarrantyUntil(projectId: string, form: FormData) {
  await requireArea("projekte");
  const v = ymd.optional().parse(opt(form.get("until")));
  await db.project.update({ where: { id: z.cuid().parse(projectId) }, data: { warrantyUntil: v ? berlinDateTime(v) : null } });
  refresh(undefined, projectId);
}
