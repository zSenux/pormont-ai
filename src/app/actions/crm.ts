"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addNote, newInquiry, NOTE_KINDS } from "@/lib/crm";

// Server-Actions der Kundenakte (Notizen, Kontakthistorie, Wiedervorlagen, neue Anfragen)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const done = (customerId: string) => {
  revalidatePath(`/buchhaltung/kunden/${customerId}`);
  revalidatePath("/");
};

export async function addCustomerNote(customerId: string, form: FormData) {
  const u = await requireUser();
  const id = z.cuid().parse(customerId);
  const n = z
    .object({ kind: z.enum(NOTE_KINDS).default("NOTIZ"), text: z.string().trim().min(1).max(4000), followUp: ymd.optional(), assigneeId: z.cuid().optional() })
    .parse({ kind: opt(form.get("kind")), text: form.get("text"), followUp: opt(form.get("followUp")), assigneeId: opt(form.get("assigneeId")) });
  await addNote({ customerId: id, ...n, authorName: u.name });
  done(id);
}

export async function toggleFollowUp(noteId: string) {
  await requireUser();
  const n = await db.customerNote.findUnique({ where: { id: z.cuid().parse(noteId) } });
  if (!n) return;
  await db.customerNote.update({ where: { id: n.id }, data: { followUpDone: n.followUpDone ? null : new Date() } });
  done(n.customerId);
}

export async function deleteCustomerNote(noteId: string) {
  await requireUser();
  const n = await db.customerNote.findUnique({ where: { id: z.cuid().parse(noteId) } });
  if (!n) return;
  await db.customerNote.delete({ where: { id: n.id } });
  done(n.customerId);
}

export async function createInquiry(customerId: string, form: FormData) {
  const u = await requireUser();
  const i = z.object({ title: z.string().trim().min(2).max(200), description: z.string().trim().max(4000).optional() }).parse({ title: form.get("title"), description: opt(form.get("description")) });
  const p = await newInquiry({ customerId: z.cuid().parse(customerId), ...i, userId: u.id, userName: u.name });
  redirect(`/projekte/${p.id}`);
}
