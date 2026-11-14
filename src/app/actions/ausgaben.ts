"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { BookError } from "@/lib/buchhaltung/docs";
import { createPurchase, deletePurchase, PAY_METHODS, PURCHASE_CATEGORIES, purchaseInput, setPurchasePaid, updatePurchase, type PurchaseInput } from "@/lib/buchhaltung/purchases";

// Server-Actions für Ausgaben (Eingangsrechnungen/Belege). requireArea("buchhaltung") prüft Anmeldung, Freischaltung und Recht.

type Result = { ok?: string; error?: string } | undefined;
const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const cents = (v: FormDataEntryValue | null) => {
  const t = s(v);
  if (!t) return null;
  const n = Number(t.replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

function fromForm(form: FormData): PurchaseInput {
  const gross = cents(form.get("gross"));
  const tax = cents(form.get("tax"));
  if (gross === null || Number.isNaN(gross)) throw new BookError("Bitte den Bruttobetrag eintragen, z. B. 119,00.");
  if (Number.isNaN(tax)) throw new BookError("Umsatzsteuer bitte als Zahl eintragen.");
  const cat = s(form.get("category"));
  const pm = s(form.get("payMethod"));
  return purchaseInput.parse({
    supplier: s(form.get("supplier")),
    docNo: s(form.get("docNo")),
    date: s(form.get("date")),
    dueDate: s(form.get("dueDate")) || null,
    category: cat in PURCHASE_CATEGORIES ? cat : "SONSTIGES",
    grossCents: gross,
    taxCents: tax,
    taxRate: Number(s(form.get("taxRate")) || 19),
    projectId: s(form.get("projectId")) || null,
    fileId: s(form.get("fileId")) || null,
    paid: form.get("paid") === "on",
    payMethod: pm in PAY_METHODS ? pm : null,
    note: s(form.get("note")),
  });
}

const fail = (e: unknown): { error: string } => ({ error: e instanceof BookError ? e.message : e instanceof z.ZodError ? e.issues.map((i) => i.message).join(" · ") : "Speichern fehlgeschlagen." });

export async function createPurchaseAction(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  let id: string;
  try {
    id = (await createPurchase(fromForm(form), user)).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/buchhaltung/ausgaben");
  revalidatePath("/belege/foto");
  redirect(`/buchhaltung/ausgaben/${id}?neu=1`);
}

export async function updatePurchaseAction(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("buchhaltung");
  try {
    await updatePurchase(z.string().min(5).max(40).parse(id), fromForm(form));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/buchhaltung/ausgaben");
  revalidatePath(`/buchhaltung/ausgaben/${id}`);
  return { ok: "Gespeichert." };
}

export async function purchasePaidAction(id: string, paid: boolean): Promise<Result> {
  await requireArea("buchhaltung");
  try {
    await setPurchasePaid(z.string().min(5).max(40).parse(id), paid);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/buchhaltung/ausgaben");
  revalidatePath(`/buchhaltung/ausgaben/${id}`);
}

export async function deletePurchaseAction(id: string): Promise<Result> {
  await requireArea("buchhaltung");
  try {
    await deletePurchase(z.string().min(5).max(40).parse(id));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/buchhaltung/ausgaben");
  redirect("/buchhaltung/ausgaben");
}
