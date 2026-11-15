"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { FileError } from "@/lib/files";
import { CONTRACT_TYPES, EMP_DOC_KINDS } from "@/lib/personal-shared";
import { addEmployeeDoc, deleteEmployeeDoc, markChecked, PersonalError, saveProfile } from "@/lib/personal";

// Server-Actions der Personalakte – ausschließlich für Administratoren

type Result = { error?: string; ok?: string };
const opt = (s: FormDataEntryValue | null, max = 300) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const date = (s: FormDataEntryValue | null) => {
  const v = opt(s);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? berlinDateTime(v) : null;
};
const done = (userId: string) => {
  revalidatePath("/personal");
  revalidatePath(`/personal/${userId}`);
};

export async function saveProfileAction(userId: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const me = await requireAdmin();
  const uid = z.cuid().parse(userId);
  const ct = opt(form.get("contractType"));
  const hours = opt(form.get("weeklyHours"))?.replace(",", ".");
  const weeklyHours = hours ? Number(hours) : null;
  if (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 60)) return { error: "Wochenstunden 0–60." };
  const email = opt(form.get("privateEmail"), 200);
  if (email && !z.email().safeParse(email).success) return { error: "Private E-Mail prüfen." };
  await saveProfile(uid, {
    jobTitle: opt(form.get("jobTitle"), 100),
    birthDate: date(form.get("birthDate")),
    street: opt(form.get("street"), 200),
    zip: opt(form.get("zip"), 10),
    city: opt(form.get("city"), 100),
    privatePhone: opt(form.get("privatePhone"), 50),
    privateEmail: email,
    emergencyContact: opt(form.get("emergencyContact"), 200),
    entryDate: date(form.get("entryDate")),
    exitDate: date(form.get("exitDate")),
    contractType: ct && (CONTRACT_TYPES as readonly string[]).includes(ct) ? (ct as (typeof CONTRACT_TYPES)[number]) : null,
    contractUntil: date(form.get("contractUntil")),
    weeklyHours,
    wage: opt(form.get("wage"), 200),
    notes: opt(form.get("notes"), 4000),
  }, me);
  done(uid);
  return { ok: "Gespeichert." };
}

export async function newEmployeeDoc(userId: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const me = await requireAdmin();
  const uid = z.cuid().parse(userId);
  const kind = z.enum(EMP_DOC_KINDS).safeParse(form.get("kind"));
  const title = opt(form.get("title"), 200);
  if (!kind.success || !title) return { error: "Bitte Art und Bezeichnung angeben." };
  const f = form.get("file");
  const file = f instanceof File && f.size ? { name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) } : null;
  try {
    await addEmployeeDoc(uid, { kind: kind.data, title, number: opt(form.get("number"), 100), issuedAt: date(form.get("issuedAt")), validUntil: date(form.get("validUntil")), nextCheck: date(form.get("nextCheck")), note: opt(form.get("note"), 1000), file }, me);
  } catch (e) {
    if (e instanceof PersonalError || e instanceof FileError) return { error: e.message };
    throw e;
  }
  done(uid);
  return { ok: "Eingetragen." };
}

export async function checkDone(userId: string, docId: string) {
  const me = await requireAdmin();
  await markChecked(z.cuid().parse(docId), 6, me);
  done(userId);
}

export async function removeEmployeeDoc(userId: string, docId: string) {
  const me = await requireAdmin();
  await deleteEmployeeDoc(z.cuid().parse(docId), me);
  done(userId);
}
