"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { berlinDateTime } from "@/lib/berlin";
import { bookStock, reorderRequest, STOCK_CATEGORIES, StockError } from "@/lib/stock";
import { SupplierError } from "@/lib/suppliers";
import { COST_KINDS } from "@/lib/nachkalkulation";

// Server-Actions für Materiallager und Nachkalkulation

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const num = (s: FormDataEntryValue | null) => {
  const v = opt(s);
  return v === undefined ? undefined : Number(v.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
};
const qty = z.number().finite().min(0).max(1_000_000);

const itemForm = z.object({
  name: z.string().trim().min(2, "Bitte eine Bezeichnung eingeben.").max(200),
  category: z.enum(STOCK_CATEGORIES),
  material: z.string().trim().max(100).optional(),
  unit: z.string().trim().min(1).max(20),
  quantity: qty.optional(),
  minQuantity: qty.optional(),
  reorderQty: qty.optional(),
  price: z.number().finite().min(0).max(1_000_000).optional(),
  location: z.string().trim().max(100).optional(),
  supplierId: z.cuid().optional(),
  articleNo: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});
const readItem = (form: FormData) =>
  itemForm.safeParse({
    name: opt(form.get("name")), category: opt(form.get("category")) ?? "SONSTIGES", material: opt(form.get("material")), unit: opt(form.get("unit")) ?? "Stk",
    quantity: num(form.get("quantity")), minQuantity: num(form.get("minQuantity")), reorderQty: num(form.get("reorderQty")), price: num(form.get("price")),
    location: opt(form.get("location")), supplierId: opt(form.get("supplierId")), articleNo: opt(form.get("articleNo")), notes: opt(form.get("notes")),
  });

export async function createStockItem(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("lager");
  const p = readItem(form);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingabe prüfen." };
  const { quantity, ...data } = p.data;
  const item = await db.stockItem.create({ data });
  if (quantity) await bookStock({ itemId: item.id, kind: "INVENTUR", qty: quantity, userName: user.name, note: "Anfangsbestand" });
  redirect(`/lager/${item.id}`);
}

export async function updateStockItem(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("lager");
  const p = readItem(form);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingabe prüfen." };
  const d = p.data;
  await db.stockItem.update({
    where: { id: z.cuid().parse(id) },
    data: { name: d.name, category: d.category, material: d.material ?? null, unit: d.unit, minQuantity: d.minQuantity ?? null, reorderQty: d.reorderQty ?? null, price: d.price ?? null, location: d.location ?? null, supplierId: d.supplierId ?? null, articleNo: d.articleNo ?? null, notes: d.notes ?? null },
  });
  revalidatePath(`/lager/${id}`);
  return { ok: "Gespeichert." };
}

export async function deleteStockItem(id: string) {
  await requireArea("lager");
  await db.stockItem.delete({ where: { id: z.cuid().parse(id) } });
  revalidatePath("/lager");
  redirect("/lager");
}

export async function bookStockAction(itemId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("lager");
  const p = z
    .object({ kind: z.enum(["EINGANG", "AUSGANG", "INVENTUR"]), qty, projectId: z.cuid().optional(), price: z.number().finite().min(0).max(1_000_000).optional(), note: z.string().trim().max(500).optional() })
    .safeParse({ kind: form.get("kind"), qty: num(form.get("qty")), projectId: opt(form.get("projectId")), price: num(form.get("price")), note: opt(form.get("note")) });
  if (!p.success) return { error: "Menge prüfen." };
  try {
    const r = await bookStock({ itemId: z.cuid().parse(itemId), ...p.data, userName: user.name });
    revalidatePath("/lager");
    revalidatePath(`/lager/${itemId}`);
    if (p.data.projectId) revalidatePath(`/projekte/${p.data.projectId}`);
    return { ok: `Gebucht. Bestand jetzt ${r.item.quantity.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${r.item.unit}.` };
  } catch (e) {
    if (e instanceof StockError) return { error: e.message };
    throw e;
  }
}

export async function reorderStock(itemId: string): Promise<Result> {
  const user = await requireArea("lager");
  let id: string;
  try {
    id = (await reorderRequest(z.cuid().parse(itemId), user)).id;
  } catch (e) {
    if (e instanceof StockError || e instanceof SupplierError) return { error: e.message };
    throw e;
  }
  redirect(`/lieferanten/anfrage/${id}`);
}

/** Artikel aus einem Lieferanten-Katalog ins Lager übernehmen (Preis je Einheit) */
export async function stockFromCatalog(catalogItemId: string) {
  await requireArea("lager");
  const c = await db.catalogItem.findUniqueOrThrow({ where: { id: z.cuid().parse(catalogItemId) } });
  const exists = await db.stockItem.findFirst({ where: { supplierId: c.supplierId, articleNo: c.articleNo }, select: { id: true } });
  const id = exists?.id ?? (await db.stockItem.create({ data: { name: c.name, category: "BESCHLAG", unit: c.unit ?? "Stk", price: c.price !== null ? Math.round((c.price / (c.priceUnit || 1)) * 10000) / 10000 : null, supplierId: c.supplierId, articleNo: c.articleNo, notes: c.description } })).id;
  redirect(`/lager/${id}`);
}

// ---------- Nachkalkulation ----------

export async function saveCalcBasics(projectId: string, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("lager");
  const p = z.object({ budgetNet: z.number().finite().min(0).max(100_000_000).optional(), hourlyRate: z.number().finite().min(0).max(1000).optional() }).safeParse({ budgetNet: num(form.get("budgetNet")), hourlyRate: num(form.get("hourlyRate")) });
  if (!p.success) return { error: "Beträge prüfen." };
  await db.project.update({ where: { id: z.cuid().parse(projectId) }, data: { budgetNet: p.data.budgetNet ?? null, hourlyRate: p.data.hourlyRate ?? null, ...(p.data.budgetNet === undefined ? { lexQuotationId: null, lexQuotationNo: null, quoteId: null } : {}) } });
  revalidatePath(`/projekte/${projectId}/nachkalkulation`);
  return { ok: "Gespeichert." };
}

/** Angebot aus der Buchhaltung verknüpfen: Nettosumme wird als Auftragswert übernommen */
export async function linkQuotation(projectId: string, _prev: Result, form: FormData): Promise<Result> {
  await requireArea("lager");
  const qid = z.string().min(5).max(40).safeParse(form.get("quotationId"));
  if (!qid.success) return { error: "Bitte ein Angebot wählen." };
  const q = await db.salesDoc.findUnique({ where: { id: qid.data }, select: { id: true, kind: true, number: true, netCents: true, status: true } });
  if (!q || q.kind !== "ANGEBOT" || !q.number) return { error: "Angebot nicht gefunden (nur festgeschriebene Angebote)." };
  await db.project.update({ where: { id: z.cuid().parse(projectId) }, data: { budgetNet: q.netCents / 100, quoteId: q.id, lexQuotationId: null, lexQuotationNo: q.number } });
  revalidatePath(`/projekte/${projectId}/nachkalkulation`);
  return { ok: "Angebot übernommen." };
}

export async function addProjectCost(projectId: string, _prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("lager");
  const p = z
    .object({ kind: z.enum(COST_KINDS), label: z.string().trim().min(2).max(200), amount: z.number().finite().min(-1_000_000).max(10_000_000), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .safeParse({ kind: form.get("kind"), label: opt(form.get("label")), amount: num(form.get("amount")), day: opt(form.get("day")) });
  if (!p.success) return { error: "Bezeichnung und Betrag prüfen." };
  await db.projectCost.create({ data: { projectId: z.cuid().parse(projectId), kind: p.data.kind, label: p.data.label, amount: p.data.amount, day: p.data.day ? berlinDateTime(p.data.day, "12:00") : new Date(), userName: user.name } });
  revalidatePath(`/projekte/${projectId}/nachkalkulation`);
  return { ok: "Kosten eingetragen." };
}

export async function deleteProjectCost(id: string) {
  await requireArea("lager");
  const c = await db.projectCost.delete({ where: { id: z.cuid().parse(id) } });
  revalidatePath(`/projekte/${c.projectId}/nachkalkulation`);
}
