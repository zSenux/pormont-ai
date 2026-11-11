"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { createRequest, parsePositions, sendRequest, SupplierError, SUPPLIER_KINDS, SUPPLIER_SUGGESTIONS } from "@/lib/suppliers";

// Server-Actions für Lieferanten, Preisanfragen und Kataloge

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);

const supplierForm = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen eingeben.").max(200),
  kind: z.enum(SUPPLIER_KINDS),
  contactName: z.string().trim().max(120).optional(),
  email: z.email("E-Mail-Adresse prüfen.").max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  website: z.url({ protocol: /^https?$/ }).max(300).optional(),
  street: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(10).optional(),
  city: z.string().trim().max(100).optional(),
  customerNo: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
});
function readSupplier(form: FormData) {
  const raw = Object.fromEntries(["name", "kind", "contactName", "email", "phone", "website", "street", "postalCode", "city", "customerNo", "notes"].map((k) => [k, opt(form.get(k))]));
  if (typeof raw.website === "string" && !/^https?:\/\//i.test(raw.website)) raw.website = `https://${raw.website}`;
  return supplierForm.safeParse(raw);
}

export async function createSupplier(_prev: Result, form: FormData): Promise<Result> {
  await requireUser();
  const p = readSupplier(form);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const s = await db.supplier.create({ data: p.data });
  redirect(`/lieferanten/${s.id}`);
}

export async function updateSupplier(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireUser();
  const p = readSupplier(form);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const d = p.data;
  await db.supplier.update({
    where: { id: z.cuid().parse(id) },
    data: { name: d.name, kind: d.kind, contactName: d.contactName ?? null, email: d.email ?? null, phone: d.phone ?? null, website: d.website ?? null, street: d.street ?? null, postalCode: d.postalCode ?? null, city: d.city ?? null, customerNo: d.customerNo ?? null, notes: d.notes ?? null },
  });
  revalidatePath(`/lieferanten/${id}`);
  return { ok: "Gespeichert." };
}

export async function deleteSupplier(id: string) {
  await requireUser();
  await db.supplier.delete({ where: { id: z.cuid().parse(id) } });
  revalidatePath("/lieferanten");
  redirect("/lieferanten");
}

/** Die vier besprochenen Lieferanten anlegen (nur fehlende) */
export async function addSuggestedSuppliers() {
  await requireUser();
  for (const s of SUPPLIER_SUGGESTIONS) {
    const exists = await db.supplier.findFirst({ where: { name: { equals: s.name, mode: "insensitive" } }, select: { id: true } });
    if (!exists) await db.supplier.create({ data: s });
  }
  revalidatePath("/lieferanten");
}

// ---------- Preisanfragen ----------

export async function createSupplierRequest(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = z
    .object({
      supplierId: z.cuid(),
      positions: z.string().trim().min(2, "Bitte mindestens eine Position eintragen.").max(20000),
      projectId: z.cuid().optional(),
      dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      delivery: z.string().trim().max(200).optional(),
      note: z.string().trim().max(2000).optional(),
    })
    .safeParse({ supplierId: form.get("supplierId"), positions: form.get("positions"), projectId: opt(form.get("projectId")), dueAt: opt(form.get("dueAt")), delivery: opt(form.get("delivery")), note: opt(form.get("note")) });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingabe prüfen." };
  let id: string;
  try {
    const r = await createRequest({ supplierId: p.data.supplierId, positions: parsePositions(p.data.positions), projectId: p.data.projectId, dueAt: p.data.dueAt ? berlinDateTime(p.data.dueAt, "12:00") : null, delivery: p.data.delivery, note: p.data.note, user });
    id = r.id;
  } catch (e) {
    if (e instanceof SupplierError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message };
    throw e;
  }
  redirect(`/lieferanten/anfrage/${id}`);
}

export async function updateRequestText(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireUser();
  const p = z.object({ subject: z.string().trim().min(3).max(200), text: z.string().trim().min(10).max(20000) }).safeParse({ subject: form.get("subject"), text: form.get("text") });
  if (!p.success) return { error: "Betreff und Text prüfen." };
  const r = await db.supplierRequest.updateMany({ where: { id: z.cuid().parse(id), status: "ENTWURF" }, data: p.data });
  if (!r.count) return { error: "Nur Entwürfe lassen sich ändern." };
  revalidatePath(`/lieferanten/anfrage/${id}`);
  return { ok: "Gespeichert." };
}

/** Senden = menschliche Freigabe (Knopf mit Rückfrage auf der Seite) */
export async function sendSupplierRequest(id: string): Promise<Result> {
  await requireUser();
  try {
    const r = await sendRequest(z.cuid().parse(id));
    revalidatePath(`/lieferanten/anfrage/${id}`);
    revalidatePath("/lieferanten");
    return { ok: `An ${r.to} gesendet.` };
  } catch (e) {
    revalidatePath(`/lieferanten/anfrage/${id}`);
    return { error: e instanceof SupplierError ? e.message : "Senden fehlgeschlagen." };
  }
}

export async function setRequestStatus(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireUser();
  const p = z
    .object({ status: z.enum(["GESENDET", "ANGEBOT", "BESTELLT", "ABGESAGT"]), offerAmount: z.coerce.number().min(0).max(100_000_000).optional(), offerNote: z.string().trim().max(2000).optional() })
    .safeParse({ status: form.get("status"), offerAmount: opt(form.get("offerAmount"))?.replace(/\./g, "").replace(",", "."), offerNote: opt(form.get("offerNote")) });
  if (!p.success) return { error: "Eingabe prüfen." };
  const r = await db.supplierRequest.updateMany({ where: { id: z.cuid().parse(id), status: { notIn: ["ENTWURF", "WIRD_GESENDET"] } }, data: { status: p.data.status, offerAmount: p.data.offerAmount ?? null, offerNote: p.data.offerNote ?? null } });
  if (!r.count) return { error: "Erst senden, dann Angebot erfassen." };
  revalidatePath(`/lieferanten/anfrage/${id}`);
  revalidatePath("/lieferanten");
  return { ok: "Gespeichert." };
}

export async function deleteRequest(id: string) {
  await requireUser();
  const r = await db.supplierRequest.findUniqueOrThrow({ where: { id: z.cuid().parse(id) }, select: { supplierId: true } });
  await db.supplierRequest.delete({ where: { id } });
  revalidatePath("/lieferanten");
  redirect(`/lieferanten/${r.supplierId}`);
}

export async function clearCatalog(supplierId: string) {
  await requireUser();
  await db.catalogItem.deleteMany({ where: { supplierId: z.cuid().parse(supplierId) } });
  revalidatePath(`/lieferanten/${supplierId}`);
}
