"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { addDefect, AssemblyError, createAssembly, setAssemblyStatus, signAcceptance, toggleCheck, updateAssembly, type AssemblyInput } from "@/lib/assembly";
import { ASM_STATUSES, readChecklist, readDefects } from "@/lib/assembly-shared";

// Server-Actions der Montageplanung (Monteure arbeiten damit am Handy)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
type Result = { ok?: string; error?: string };

function parse(form: FormData): Omit<AssemblyInput, "projectId"> {
  const a = z
    .object({ title: z.string().trim().min(2).max(200), date: ymd, from: hm.optional(), to: hm.optional(), days: z.coerce.number().int().min(1).max(30).optional(), address: z.string().trim().max(300).optional(), vehicle: z.string().trim().max(80).optional(), leaderId: z.cuid().optional(), plan: z.string().trim().max(8000).optional(), crewIds: z.array(z.cuid()).max(20) })
    .parse({ title: form.get("title"), date: form.get("date"), from: opt(form.get("from")), to: opt(form.get("to")), days: opt(form.get("days")), address: opt(form.get("address")), vehicle: opt(form.get("vehicle")), leaderId: opt(form.get("leaderId")), plan: opt(form.get("plan")), crewIds: form.getAll("crew").map(String).filter(Boolean) });
  return a;
}

const refresh = (id?: string) => {
  revalidatePath("/montage");
  if (id) revalidatePath(`/montage/${id}`);
  revalidatePath("/kalender");
  revalidatePath("/");
};

export async function newAssembly(form: FormData) {
  const user = await requireArea("montage");
  const a = await createAssembly({ projectId: z.cuid().parse(form.get("projectId")), ...parse(form) }, user);
  refresh(a.id);
  redirect(`/montage/${a.id}`);
}

export async function editAssembly(id: string, form: FormData) {
  await requireArea("montage");
  const aid = z.cuid().parse(id);
  const a = await db.assembly.findUniqueOrThrow({ where: { id: aid }, select: { projectId: true } });
  await updateAssembly(aid, { projectId: a.projectId, ...parse(form) });
  refresh(aid);
}

export async function assemblyStatus(id: string, status: string): Promise<Result> {
  const user = await requireArea("montage");
  try {
    await setAssemblyStatus(z.cuid().parse(id), z.enum(ASM_STATUSES).parse(status), user);
  } catch (e) {
    if (e instanceof AssemblyError) return { error: e.message };
    throw e;
  }
  refresh(id);
  return { ok: "Gespeichert." };
}

export async function checkItem(id: string, index: number) {
  const user = await requireArea("montage");
  await toggleCheck(z.cuid().parse(id), z.number().int().min(0).max(100).parse(index), user);
  refresh(id);
}

export async function addCheckItem(id: string, form: FormData) {
  await requireArea("montage");
  const text = z.string().trim().min(2).max(300).parse(form.get("text"));
  const a = await db.assembly.findUniqueOrThrow({ where: { id: z.cuid().parse(id) }, select: { checklist: true } });
  await db.assembly.update({ where: { id }, data: { checklist: [...readChecklist(a.checklist), { text, done: false }] } });
  refresh(id);
}

export async function saveReport(id: string, form: FormData) {
  await requireArea("montage");
  const report = z.string().trim().max(8000).optional().parse(opt(form.get("report")));
  await db.assembly.update({ where: { id: z.cuid().parse(id) }, data: { report: report ?? null } });
  refresh(id);
}

export async function newDefect(id: string, form: FormData) {
  const user = await requireArea("montage");
  await addDefect(z.cuid().parse(id), z.string().trim().min(2).max(1000).parse(form.get("text")), user);
  refresh(id);
}

export async function toggleDefect(id: string, index: number) {
  const user = await requireArea("montage");
  const a = await db.assembly.findUniqueOrThrow({ where: { id: z.cuid().parse(id) }, select: { defects: true } });
  const list = readDefects(a.defects);
  const d = list[z.number().int().min(0).parse(index)];
  if (!d) return;
  list[index] = { ...d, fixed: !d.fixed, by: user.name, at: new Date().toISOString() };
  await db.assembly.update({ where: { id }, data: { defects: list } });
  refresh(id);
}

export async function signAction(id: string, input: { signerName: string; signature: string; note?: string }): Promise<Result> {
  const user = await requireArea("montage");
  try {
    const v = z.object({ signerName: z.string().trim().min(2).max(120), signature: z.string().max(400_000), note: z.string().trim().max(2000).optional() }).parse(input);
    await signAcceptance(z.cuid().parse(id), { ...v, note: v.note || null }, user);
  } catch (e) {
    if (e instanceof AssemblyError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Bitte Namen des Unterzeichners angeben." };
    throw e;
  }
  refresh(id);
  revalidatePath(`/montage/${id}/protokoll`);
  return { ok: "Abnahme gespeichert." };
}

export async function deleteAssembly(id: string) {
  await requireArea("montage");
  const a = await db.assembly.findUnique({ where: { id: z.cuid().parse(id) } });
  if (a?.eventId) await db.event.deleteMany({ where: { id: a.eventId } });
  await db.assembly.deleteMany({ where: { id } });
  refresh();
  redirect("/montage");
}
