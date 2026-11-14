"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/user";
import { requireArea } from "@/lib/rights";
import { todayYmd } from "@/lib/berlin";
import { bookConfig, bookConfigSchema, saveBookConfig } from "@/lib/buchhaltung/config";
import { addPayment, BookError, cancelInvoice, copyDoc, downPaymentFromQuote, createDraft, deleteDraft, deletePayment, draftInput, finalizeDoc, setNextNumber, setQuoteStatus, updateDraft, type DraftInput } from "@/lib/buchhaltung/docs";
import { createDunning, sendDoc, sendDunning } from "@/lib/buchhaltung/send";
import { articleInput, createCustomer, customerInput, updateCustomer } from "@/lib/buchhaltung/customers";
import { startLexwareImport } from "@/lib/buchhaltung/lexware-import";
import type { DocKind } from "@/lib/buchhaltung/types";

// Server-Actions der Buchhaltung. Jede Action prüft die Anmeldung (und damit die Freischaltung) über requireUser().

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : null);
const num = (s: FormDataEntryValue | null) => {
  const v = opt(s);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const cuid = z.string().min(1).max(40);

function fail(e: unknown): { error: string } {
  if (e instanceof BookError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
  console.error("[buchhaltung]", e);
  return { error: e instanceof Error && e.message.length < 300 ? e.message : "Das hat nicht geklappt." };
}

const refresh = (id?: string) => {
  revalidatePath("/buchhaltung", "layout");
  if (id) revalidatePath(`/buchhaltung/beleg/${id}`);
};

// ---------- Belege ----------

export async function newDocAction(kind: DocKind, opts: { customerId?: string; projectId?: string } = {}) {
  const user = await requireArea("buchhaltung");
  const doc = await createDraft(z.enum(["ANGEBOT", "RECHNUNG"]).parse(kind), { customerId: opts.customerId ? cuid.parse(opts.customerId) : null, projectId: opts.projectId ? cuid.parse(opts.projectId) : null }, user);
  redirect(`/buchhaltung/beleg/${doc.id}`);
}

export async function saveDraftAction(id: string, input: DraftInput): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await updateDraft(cuid.parse(id), draftInput.parse(input), user);
    refresh(id);
    return { ok: "Gespeichert." };
  } catch (e) {
    return fail(e);
  }
}

export async function finalizeAction(id: string, input: DraftInput): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await updateDraft(cuid.parse(id), draftInput.parse(input), user);
    const r = await finalizeDoc(id, user);
    refresh(id);
    return { ok: `Festgeschrieben: ${r.number}` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDraftAction(id: string) {
  await requireArea("buchhaltung");
  const d = await db.salesDoc.findUnique({ where: { id: cuid.parse(id) }, select: { kind: true } });
  await deleteDraft(id);
  refresh();
  redirect(`/buchhaltung/belege?art=${d?.kind === "ANGEBOT" ? "angebote" : "rechnungen"}`);
}

export async function cancelAction(id: string): Promise<Result> {
  const user = await requireArea("buchhaltung");
  let creditId: string;
  try {
    creditId = (await cancelInvoice(cuid.parse(id), user)).creditId;
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  redirect(`/buchhaltung/beleg/${creditId}`);
}

export async function copyAction(id: string, kind: DocKind, invoiceType?: "NORMAL" | "SCHLUSS"): Promise<Result> {
  const user = await requireArea("buchhaltung");
  let newId: string;
  try {
    newId = (await copyDoc(cuid.parse(id), z.enum(["ANGEBOT", "RECHNUNG"]).parse(kind), user, { invoiceType: z.enum(["NORMAL", "SCHLUSS"]).optional().parse(invoiceType) })).id;
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  redirect(`/buchhaltung/beleg/${newId}`);
}

/** Abschlagsrechnung aus einem Angebot (Formular: Prozent oder Nettobetrag) */
export async function downPaymentAction(quoteId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  const mode = form.get("mode") === "betrag" ? "betrag" : "prozent";
  const raw = String(form.get("value") ?? "").trim().replace(/\./g, "").replace(",", ".");
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) return { error: mode === "prozent" ? "Bitte einen Prozentsatz eintragen, z. B. 30." : "Bitte einen Nettobetrag eintragen." };
  let newId: string;
  try {
    newId = (await downPaymentFromQuote(cuid.parse(quoteId), mode === "prozent" ? { percent: value } : { netEuro: value }, user)).id;
  } catch (e) {
    return fail(e);
  }
  refresh(quoteId);
  redirect(`/buchhaltung/beleg/${newId}`);
}

export async function quoteStatusAction(id: string, status: "OFFEN" | "ANGENOMMEN" | "ABGELEHNT"): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await setQuoteStatus(cuid.parse(id), z.enum(["OFFEN", "ANGENOMMEN", "ABGELEHNT"]).parse(status), user);
    refresh(id);
    return { ok: "Gespeichert." };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Zahlungen, Versand, Mahnungen ----------

export async function paymentAction(docId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount === 0) return { error: "Bitte den Betrag eintragen." };
  try {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(todayYmd()).parse(opt(form.get("day")) ?? todayYmd());
    const r = await addPayment(cuid.parse(docId), { day, amountCents: Math.round(amount * 100), method: opt(form.get("method")) ?? undefined, note: opt(form.get("note")) }, user);
    refresh(docId);
    return { ok: r.status === "BEZAHLT" ? "Erfasst – die Rechnung ist bezahlt." : "Zahlung erfasst." };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePaymentAction(paymentId: string) {
  const user = await requireArea("buchhaltung");
  const docId = await deletePayment(cuid.parse(paymentId), user);
  refresh(docId);
}

function readMail(form: FormData) {
  return { an: opt(form.get("an")) ?? "", cc: opt(form.get("cc")) ?? undefined, betreff: opt(form.get("betreff")) ?? "", text: opt(form.get("text")) ?? "", xml: form.get("xml") === "on" };
}

export async function sendDocAction(docId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    const r = await sendDoc(cuid.parse(docId), readMail(form), user);
    refresh(docId);
    return { ok: `Gesendet an ${r.to}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function createDunningAction(docId: string): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await createDunning(cuid.parse(docId), user);
    refresh(docId);
    return { ok: "Mahnung erstellt." };
  } catch (e) {
    return fail(e);
  }
}

export async function sendDunningAction(dunningId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    const m = readMail(form);
    const r = await sendDunning(cuid.parse(dunningId), m, user);
    refresh();
    return { ok: `${r.label} gesendet an ${r.to}.` };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Kunden & Artikel ----------

function readCustomer(form: FormData) {
  const days = num(form.get("paymentDays"));
  return customerInput.safeParse({
    kind: opt(form.get("kind")) ?? "FIRMA",
    company: opt(form.get("company")),
    salutation: opt(form.get("salutation")),
    firstName: opt(form.get("firstName")),
    lastName: opt(form.get("lastName")),
    contactName: opt(form.get("contactName")),
    email: opt(form.get("email")),
    phone: opt(form.get("phone")),
    street: opt(form.get("street")),
    zip: opt(form.get("zip")),
    city: opt(form.get("city")),
    country: opt(form.get("country")) ?? "DE",
    vatId: opt(form.get("vatId")),
    buyerReference: opt(form.get("buyerReference")),
    paymentDays: days === null || Number.isNaN(days) ? null : Math.round(days),
    notes: opt(form.get("notes")),
  });
}

export async function createCustomerAction(_prev: Result, form: FormData): Promise<Result> {
  await requireArea("buchhaltung");
  const p = readCustomer(form);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const c = await createCustomer(p.data);
  refresh();
  const back = opt(form.get("back"));
  if (back && /^\/buchhaltung\/beleg\/[a-z0-9]+$/.test(back)) {
    await db.salesDoc.updateMany({ where: { id: back.split("/").pop()!, status: "ENTWURF" }, data: { customerId: c.id } });
    redirect(back);
  }
  redirect(`/buchhaltung/kunden/${c.id}`);
}

export async function updateCustomerAction(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("buchhaltung");
  const p = readCustomer(form);
  if (!p.success) return { error: p.error.issues[0]?.message };
  await updateCustomer(cuid.parse(id), p.data);
  refresh();
  return { ok: "Gespeichert. Bereits festgeschriebene Belege behalten die alte Anschrift." };
}

export async function archiveCustomerAction(id: string, archived: boolean) {
  await requireArea("buchhaltung");
  await db.customer.update({ where: { id: cuid.parse(id) }, data: { archived } });
  refresh();
}

function readArticle(form: FormData) {
  return articleInput.safeParse({
    number: opt(form.get("number")),
    name: opt(form.get("name")) ?? "",
    description: opt(form.get("description")),
    unit: opt(form.get("unit")) ?? "Stk",
    priceNet: num(form.get("priceNet")) ?? 0,
    taxRate: Number(opt(form.get("taxRate")) ?? 19),
    kind: opt(form.get("kind")) ?? "LEISTUNG",
  });
}

export async function saveArticleAction(id: string | null, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("buchhaltung");
  const p = readArticle(form);
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (id) await db.article.update({ where: { id: cuid.parse(id) }, data: p.data });
  else await db.article.create({ data: p.data });
  refresh();
  return { ok: id ? "Gespeichert." : `„${p.data.name}“ angelegt.` };
}

export async function archiveArticleAction(id: string) {
  await requireArea("buchhaltung");
  await db.article.update({ where: { id: cuid.parse(id) }, data: { archived: true } });
  refresh();
}

// ---------- Einstellungen (Admin) ----------

export async function saveBookConfigAction(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const cur = await bookConfig();
  const n = (k: string, d: number) => {
    const v = num(form.get(k));
    return v === null || Number.isNaN(v) ? d : v;
  };
  const p = bookConfigSchema.safeParse({
    ...cur,
    iban: opt(form.get("iban")) ?? "",
    bic: opt(form.get("bic")) ?? "",
    bankName: opt(form.get("bankName")) ?? "",
    taxNumber: opt(form.get("taxNumber")) ?? "",
    contactName: opt(form.get("contactName")) ?? "Buchhaltung",
    paymentDays: Math.round(n("paymentDays", cur.paymentDays)),
    quoteDays: Math.round(n("quoteDays", cur.quoteDays)),
    dunningDays: Math.round(n("dunningDays", cur.dunningDays)),
    dunningFee1: n("dunningFee1", cur.dunningFee1),
    dunningFee2: n("dunningFee2", cur.dunningFee2),
    quoteIntro: opt(form.get("quoteIntro")) ?? "",
    quoteOutro: opt(form.get("quoteOutro")) ?? "",
    invoiceIntro: opt(form.get("invoiceIntro")) ?? "",
    invoiceOutro: opt(form.get("invoiceOutro")) ?? "",
    datevBerater: opt(form.get("datevBerater")) ?? "",
    datevMandant: opt(form.get("datevMandant")) ?? "",
    datevSkr: form.get("datevSkr") === "04" ? "04" : "03",
    datevWjMonth: Math.round(n("datevWjMonth", cur.datevWjMonth)),
  });
  if (!p.success) return { error: p.error.issues[0]?.message };
  await saveBookConfig(p.data);
  refresh();
  return { ok: "Gespeichert." };
}

export async function setNextNumberAction(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const p = z.object({ kind: z.enum(["RECHNUNG", "ANGEBOT", "GUTSCHRIFT"]), year: z.number().int().min(2020).max(2100), next: z.number().int().min(1).max(999_999) }).safeParse({ kind: opt(form.get("kind")), year: num(form.get("year")), next: num(form.get("next")) });
  if (!p.success) return { error: "Bitte Art, Jahr und nächste Nummer angeben." };
  try {
    await setNextNumber(p.data.kind, p.data.year, p.data.next);
    refresh();
    return { ok: "Nummernkreis angepasst." };
  } catch (e) {
    return fail(e);
  }
}

export async function startImportAction(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireAdmin();
  try {
    await startLexwareImport({ seit: opt(form.get("seit")), angebote: form.get("angebote") === "on" }, user.name);
    refresh();
    return { ok: "Übernahme gestartet – das dauert je nach Menge ein paar Minuten." };
  } catch (e) {
    return fail(e);
  }
}
