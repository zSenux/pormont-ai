"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { FileError } from "@/lib/files";
import { redirect } from "next/navigation";
import { CONTRACT_TYPES, EMP_DOC_KINDS, Q_KEYS } from "@/lib/personal-shared";
import { FUNKTIONEN } from "@/lib/rights-shared";
import { addEmployeeDoc, createEmployee, deleteEmployeeDoc, markChecked, PersonalError, saveProfile, saveQuestionnaire } from "@/lib/personal";

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
  // Datei(en): hochgeladen oder mit der Kamera fotografiert – mehrere Seiten werden zu einem PDF
  const list = [...form.getAll("file"), ...form.getAll("scan")].filter((f): f is File => f instanceof File && f.size > 0);
  if (list.reduce((s, f) => s + f.size, 0) > 9 * 1024 * 1024) return { error: "Zusammen höchstens 9 MB – bitte weniger Seiten oder kleinere Fotos." };
  const files = await Promise.all(list.map(async (f) => ({ name: f.name || "Foto.jpg", mime: f.type, data: Buffer.from(await f.arrayBuffer()) })));
  try {
    await addEmployeeDoc(uid, { kind: kind.data, title, number: opt(form.get("number"), 100), issuedAt: date(form.get("issuedAt")), validUntil: date(form.get("validUntil")), nextCheck: date(form.get("nextCheck")), note: opt(form.get("note"), 1000), files }, me);
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

/** Neuen Mitarbeiter anlegen (ohne App-Zugang) und direkt in seine Akte springen */
export async function newEmployeeAction(_prev: Result | undefined, form: FormData): Promise<Result> {
  const me = await requireAdmin();
  const name = opt(form.get("name"), 80);
  if (!name || name.length < 2) return { error: "Bitte Vor- und Nachnamen eingeben." };
  const ct = opt(form.get("contractType"));
  const fn = opt(form.get("funktion"));
  let id: string;
  try {
    ({ id } = await createEmployee({ name, jobTitle: opt(form.get("jobTitle"), 100), entryDate: date(form.get("entryDate")), contractType: ct && (CONTRACT_TYPES as readonly string[]).includes(ct) ? (ct as (typeof CONTRACT_TYPES)[number]) : null, funktion: fn && (FUNKTIONEN as readonly string[]).includes(fn) ? fn : null }, me));
  } catch (e) {
    if (e instanceof PersonalError) return { error: e.message };
    throw e;
  }
  revalidatePath("/personal");
  redirect(`/personal/${id}/fragebogen`);
}

export async function saveQuestionnaireAction(userId: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const me = await requireAdmin();
  const uid = z.cuid().parse(userId);
  const values = Object.fromEntries(Q_KEYS.map((k) => [k, typeof form.get(`q_${k}`) === "string" ? String(form.get(`q_${k}`)) : ""]));
  try {
    const st = await saveQuestionnaire(uid, values, me);
    done(uid);
    revalidatePath(`/personal/${uid}/fragebogen`);
    return { ok: st.missing.length ? `Gespeichert – noch offen: ${st.missing.slice(0, 4).join(", ")}${st.missing.length > 4 ? " …" : ""}` : "Gespeichert – Fragebogen vollständig." };
  } catch (e) {
    if (e instanceof PersonalError) return { error: e.message };
    throw e;
  }
}
