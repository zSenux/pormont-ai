"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { berlinDateTime } from "@/lib/berlin";
import { FileError, storeFile } from "@/lib/files";
import { createSupplierOrder, orderFromRequest, OrderError, receiveGoods } from "@/lib/bestellungen";

// Server-Actions der Bestellungen (Einkauf) und des Wareneingangs

type Result = { error?: string; ok?: string };
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);

export async function newSupplierOrder(_prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireArea("einkauf");
  const p = z
    .object({ supplierId: z.cuid(), projectId: z.cuid().optional(), positions: z.string().trim().min(2).max(10000), expectedAt: ymd.optional(), supplierRef: z.string().trim().max(80).optional(), note: z.string().trim().max(2000).optional() })
    .safeParse({ supplierId: opt(form.get("supplierId")), projectId: opt(form.get("projectId")), positions: form.get("positions"), expectedAt: opt(form.get("expectedAt")), supplierRef: opt(form.get("supplierRef")), note: opt(form.get("note")) });
  if (!p.success) return { error: "Bitte Lieferant und Positionen angeben." };
  let id: string;
  try {
    const o = await createSupplierOrder({ ...p.data, expectedAt: p.data.expectedAt ? berlinDateTime(p.data.expectedAt, "12:00") : null }, u);
    id = o.id;
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  revalidatePath("/bestellungen");
  redirect(`/bestellungen/${id}`);
}

export async function supplierOrderFromRequest(requestId: string) {
  const u = await requireArea("einkauf");
  const o = await orderFromRequest(z.cuid().parse(requestId), u);
  redirect(`/bestellungen/${o.id}`);
}

export async function receiveAction(orderId: string, _prev: Result | undefined, form: FormData): Promise<Result> {
  const u = await requireArea("lager");
  const id = z.cuid().parse(orderId);
  const lines: { index: number; qty: number; stockItemId?: string | null }[] = [];
  for (const [k, v] of form.entries()) {
    const m = k.match(/^qty_(\d+)$/);
    if (!m || typeof v !== "string" || !v.trim()) continue;
    const qty = Number(v.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000) return { error: `Position ${Number(m[1]) + 1}: Menge prüfen.` };
    const st = form.get(`stock_${m[1]}`);
    lines.push({ index: Number(m[1]), qty, stockItemId: typeof st === "string" ? (st ? z.cuid().parse(st) : null) : undefined });
  }
  const meta = z.object({ slipNo: z.string().trim().max(80).optional(), note: z.string().trim().max(2000).optional() }).parse({ slipNo: opt(form.get("slipNo")), note: opt(form.get("note")) });
  let fileId: string | null = null;
  const photo = form.get("photo");
  try {
    if (photo instanceof File && photo.size) {
      const o = await db.supplierOrder.findUnique({ where: { id }, select: { projectId: true, number: true } });
      const f = await storeFile({ name: photo.name || `Lieferschein ${o?.number ?? ""}.jpg`, mime: photo.type, data: Buffer.from(await photo.arrayBuffer()), kind: "dokument", projectId: o?.projectId, uploadedBy: u.name });
      fileId = f.id;
    }
    const r = await receiveGoods(id, { lines, ...meta, fileId }, u);
    revalidatePath(`/bestellungen/${id}`);
    revalidatePath("/bestellungen");
    revalidatePath("/lager");
    return { ok: r.done ? "Wareneingang gebucht – Bestellung komplett geliefert." : "Wareneingang gebucht – es ist noch etwas offen." };
  } catch (e) {
    if (e instanceof OrderError || e instanceof FileError) return { error: e.message };
    throw e;
  }
}

export async function setExpected(orderId: string, form: FormData) {
  await requireArea("einkauf");
  const d = ymd.optional().parse(opt(form.get("expectedAt")));
  const ref = z.string().trim().max(80).optional().parse(opt(form.get("supplierRef")));
  await db.supplierOrder.update({ where: { id: z.cuid().parse(orderId) }, data: { expectedAt: d ? berlinDateTime(d, "12:00") : null, supplierRef: ref ?? null } });
  revalidatePath(`/bestellungen/${orderId}`);
}

export async function cancelSupplierOrder(orderId: string) {
  await requireArea("einkauf");
  const id = z.cuid().parse(orderId);
  // Stornieren nur, solange nichts geliefert wurde
  await db.supplierOrder.updateMany({ where: { id, status: "BESTELLT" }, data: { status: "STORNIERT" } });
  revalidatePath(`/bestellungen/${id}`);
  revalidatePath("/bestellungen");
}
