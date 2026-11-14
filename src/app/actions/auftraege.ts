"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { berlinDateTime } from "@/lib/berlin";
import { changeOrderStatus, createOrder, createOrderFromQuote, OrderError } from "@/lib/orders";
import { ORDER_STATUSES } from "@/lib/orders-shared";

// Server-Actions für Aufträge (EPS). Auftrag = interne Daten; Buchhaltungsbelege werden hier nie geändert
// (Ausnahme: Angebot OFFEN → ANGENOMMEN beim Anlegen aus dem Angebot).

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const euroToCents = (s?: string) => {
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) : 0;
};

export async function orderFromQuote(quoteId: string): Promise<{ error?: string }> {
  const user = await requireArea("auftraege");
  let id: string;
  try {
    id = (await createOrderFromQuote(z.cuid().parse(quoteId), user)).order.id;
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  revalidatePath("/auftraege");
  redirect(`/auftraege/${id}`);
}

export async function newOrder(form: FormData) {
  const user = await requireArea("auftraege");
  const o = z
    .object({ title: z.string().trim().min(2).max(200), customerId: z.cuid().optional(), value: z.string().max(20).optional(), start: ymd.optional(), due: ymd.optional(), address: z.string().trim().max(300).optional(), customerRef: z.string().trim().max(100).optional(), leaderId: z.cuid().optional() })
    .parse({ title: form.get("title"), customerId: opt(form.get("customerId")), value: opt(form.get("value")), start: opt(form.get("start")), due: opt(form.get("due")), address: opt(form.get("address")), customerRef: opt(form.get("customerRef")), leaderId: opt(form.get("leaderId")) });
  const order = await createOrder({ ...o, valueCents: euroToCents(o.value) }, user);
  redirect(`/auftraege/${order.id}`);
}

export async function updateOrder(id: string, form: FormData) {
  await requireArea("auftraege");
  const oid = z.cuid().parse(id);
  const o = z
    .object({ title: z.string().trim().min(2).max(200), value: z.string().max(20).optional(), start: ymd.optional(), due: ymd.optional(), customerRef: z.string().trim().max(100).optional(), material: z.string().trim().max(8000).optional(), production: z.string().trim().max(8000).optional(), notes: z.string().trim().max(8000).optional() })
    .parse({ title: form.get("title"), value: opt(form.get("value")), start: opt(form.get("start")), due: opt(form.get("due")), customerRef: opt(form.get("customerRef")), material: opt(form.get("material")), production: opt(form.get("production")), notes: opt(form.get("notes")) });
  const order = await db.order.update({
    where: { id: oid },
    data: { title: o.title, valueCents: euroToCents(o.value), startDate: o.start ? berlinDateTime(o.start) : null, dueDate: o.due ? berlinDateTime(o.due) : null, customerRef: o.customerRef ?? null, material: o.material ?? null, production: o.production ?? null, notes: o.notes ?? null },
  });
  // Fertigstellungstermin = geplantes Projektende
  await db.project.update({ where: { id: order.projectId }, data: { endDate: order.dueDate, startDate: order.startDate ?? undefined } });
  revalidatePath(`/auftraege/${oid}`);
  revalidatePath("/auftraege");
}

export async function setOrderStatus(id: string, status: string) {
  const u = await requireArea("auftraege");
  const s = z.enum(ORDER_STATUSES).parse(status);
  const order = await changeOrderStatus(z.cuid().parse(id), s, u.name);
  revalidatePath(`/auftraege/${order.id}`);
  revalidatePath("/auftraege");
  revalidatePath(`/projekte/${order.projectId}`);
}
