"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { berlinDateTime } from "@/lib/berlin";
import { FileError } from "@/lib/files";
import { NU_CONTRACT_STATUSES, NU_DOC_KINDS } from "@/lib/nachunternehmer-shared";
import { addNuDoc, createContract, createSubcontractor, deleteNuDoc, NuError, setContractStatus, updateSubcontractor } from "@/lib/nachunternehmer";

// Server-Actions für Nachunternehmer (Bereich Einkauf)

type Result = { error?: string; ok?: string };
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : null);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const date = (s: FormDataEntryValue | null) => {
  const v = opt(s);
  return v && ymd.safeParse(v).success ? berlinDateTime(v) : null;
};
const num = (s: FormDataEntryValue | null) => {
  const v = opt(s)?.replace(/\./g, "").replace(",", ".");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const subSchema = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen angeben.").max(200),
  trade: z.string().max(100).nullable(),
  contactName: z.string().max(100).nullable(),
  email: z.email("E-Mail prüfen").max(200).nullable(),
  phone: z.string().max(50).nullable(),
  street: z.string().max(200).nullable(),
  zip: z.string().max(10).nullable(),
  city: z.string().max(100).nullable(),
  taxNumber: z.string().max(40).nullable(),
  notes: z.string().max(4000).nullable(),
});
const subOf = (f: FormData) => subSchema.safeParse({ name: opt(f.get("name")) ?? "", trade: opt(f.get("trade")), contactName: opt(f.get("contactName")), email: opt(f.get("email")), phone: opt(f.get("phone")), street: opt(f.get("street")), zip: opt(f.get("zip")), city: opt(f.get("city")), taxNumber: opt(f.get("taxNumber")), notes: opt(f.get("notes")) });

export async function newSubcontractor(_prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireArea("einkauf");
  const p = subOf(form);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen." };
  let id: string;
  try {
    id = (await createSubcontractor(p.data, u)).id;
  } catch (e) {
    if (e instanceof NuError) return { error: e.message };
    throw e;
  }
  revalidatePath("/nachunternehmer");
  redirect(`/nachunternehmer/${id}`);
}

export async function saveSubcontractor(id: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  await requireArea("einkauf");
  const p = subOf(form);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen." };
  await updateSubcontractor(z.cuid().parse(id), { ...p.data, active: form.get("active") === "on" });
  revalidatePath("/nachunternehmer");
  revalidatePath(`/nachunternehmer/${id}`);
  return { ok: "Gespeichert." };
}

export async function newNuDoc(id: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireArea("einkauf");
  const kind = z.enum(NU_DOC_KINDS).safeParse(form.get("kind"));
  if (!kind.success) return { error: "Bitte die Art des Nachweises wählen." };
  const f = form.get("file");
  const file = f instanceof File && f.size ? { name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) } : null;
  const validUntil = date(form.get("validUntil"));
  if (!validUntil && kind.data !== "GEWERBE" && kind.data !== "SONSTIGES" && kind.data !== "MINDESTLOHN") return { error: "Bitte „Gültig bis“ eintragen – sonst gibt es keine Ablaufwarnung." };
  try {
    await addNuDoc(z.cuid().parse(id), { kind: kind.data, title: opt(form.get("title"))?.slice(0, 200), number: opt(form.get("number"))?.slice(0, 100), validFrom: date(form.get("validFrom")), validUntil, note: opt(form.get("note"))?.slice(0, 1000), file }, u);
  } catch (e) {
    if (e instanceof NuError || e instanceof FileError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/nachunternehmer/${id}`);
  revalidatePath("/nachunternehmer");
  return { ok: "Nachweis gespeichert." };
}

export async function removeNuDoc(subId: string, docId: string) {
  await requireArea("einkauf");
  await deleteNuDoc(z.cuid().parse(docId));
  revalidatePath(`/nachunternehmer/${subId}`);
  revalidatePath("/nachunternehmer");
}

export async function newContract(id: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireArea("einkauf");
  const p = z
    .object({ title: z.string().trim().min(2, "Bitte einen Titel angeben.").max(200), projectId: z.cuid().nullable(), scope: z.string().max(4000).nullable(), status: z.enum(NU_CONTRACT_STATUSES) })
    .safeParse({ title: opt(form.get("title")) ?? "", projectId: opt(form.get("projectId")), scope: opt(form.get("scope")), status: form.get("status") ?? "BEAUFTRAGT" });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingaben prüfen." };
  const amountNet = num(form.get("amountNet"));
  const retentionPct = num(form.get("retentionPct"));
  if (amountNet !== null && (amountNet < 0 || amountNet > 10_000_000)) return { error: "Betrag prüfen." };
  if (retentionPct !== null && (retentionPct < 0 || retentionPct > 20)) return { error: "Sicherheitseinbehalt 0–20 %." };
  const c = await createContract({ subcontractorId: z.cuid().parse(id), ...p.data, amountNet, retentionPct, startDate: date(form.get("startDate")), endDate: date(form.get("endDate")) }, u);
  revalidatePath(`/nachunternehmer/${id}`);
  return { ok: `Vertrag ${c.number} angelegt.` };
}

export async function changeContractStatus(subId: string, contractId: string, form: FormData) {
  await requireArea("einkauf");
  await setContractStatus(z.cuid().parse(contractId), z.enum(NU_CONTRACT_STATUSES).parse(form.get("status")));
  revalidatePath(`/nachunternehmer/${subId}`);
}
