"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { createJob, setJobStatus } from "@/lib/production";
import { PROD_STATUSES } from "@/lib/production-shared";
import { PRIORITIES } from "@/lib/phases-shared";

// Server-Actions der Fertigungsplanung

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const hours = z.string().max(10).transform((s) => Number(s.replace(",", "."))).pipe(z.number().min(0).max(5000)).optional();

const jobForm = (form: FormData) =>
  z
    .object({
      title: z.string().trim().min(2).max(200),
      instructions: z.string().trim().max(8000).optional(),
      quantity: z.string().trim().max(60).optional(),
      machine: z.string().trim().max(60).optional(),
      assigneeId: z.cuid().optional(),
      start: ymd.optional(),
      end: ymd.optional(),
      plannedHours: hours,
      priority: z.enum(PRIORITIES).default("NORMAL"),
    })
    .parse({ title: form.get("title"), instructions: opt(form.get("instructions")), quantity: opt(form.get("quantity")), machine: opt(form.get("machine")), assigneeId: opt(form.get("assigneeId")), start: opt(form.get("start")), end: opt(form.get("end")), plannedHours: opt(form.get("plannedHours")), priority: opt(form.get("priority")) });

const refresh = (id?: string, projectId?: string) => {
  revalidatePath("/fertigung");
  if (id) revalidatePath(`/fertigung/${id}`);
  if (projectId) revalidatePath(`/projekte/${projectId}`);
  revalidatePath("/");
};

export async function newJob(form: FormData) {
  const user = await requireUser();
  const projectId = z.cuid().parse(form.get("projectId"));
  const job = await createJob({ projectId, ...jobForm(form) }, user);
  refresh(job.id, projectId);
  redirect(`/fertigung/${job.id}`);
}

export async function updateJob(id: string, form: FormData) {
  await requireUser();
  const j = jobForm(form);
  const job = await db.productionJob.update({
    where: { id: z.cuid().parse(id) },
    data: { title: j.title, instructions: j.instructions ?? null, quantity: j.quantity ?? null, machine: j.machine ?? null, assigneeId: j.assigneeId ?? null, plannedStart: j.start ? berlinDateTime(j.start) : null, plannedEnd: j.end ? berlinDateTime(j.end) : null, plannedHours: j.plannedHours ?? null, priority: j.priority },
  });
  refresh(job.id, job.projectId);
}

export async function moveJob(id: string, status: string) {
  const user = await requireUser();
  const jid = z.cuid().parse(id);
  await setJobStatus(jid, z.enum(PROD_STATUSES).parse(status), user);
  refresh(jid);
}

export async function reportJob(id: string, form: FormData) {
  const user = await requireUser();
  const jid = z.cuid().parse(id);
  const r = z.object({ status: z.enum(PROD_STATUSES), actualHours: hours, qcNote: z.string().trim().max(4000).optional(), materialNote: z.string().trim().max(2000).optional() }).parse({ status: form.get("status"), actualHours: opt(form.get("actualHours")), qcNote: opt(form.get("qcNote")), materialNote: opt(form.get("materialNote")) });
  if (r.materialNote !== undefined) await db.productionJob.update({ where: { id: jid }, data: { materialNote: r.materialNote } });
  await setJobStatus(jid, r.status, user, { actualHours: r.actualHours, qcNote: r.qcNote });
  refresh(jid);
}

export async function deleteJob(id: string) {
  await requireUser();
  const job = await db.productionJob.delete({ where: { id: z.cuid().parse(id) } }).catch(() => null);
  refresh(undefined, job?.projectId);
  redirect("/fertigung");
}
