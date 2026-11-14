import "server-only";
import { db } from "@/lib/db";
import { berlinParts, formatDate } from "@/lib/berlin";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { sendPush } from "@/lib/push";
import { setPhase } from "@/lib/phases";
import { parsePositions } from "@/lib/suppliers";
import { BE_LABEL, fmtNum, openQty, readLines, type BeLine, type BeStatus } from "@/lib/bestellungen-shared";

// Bestellungen beim Lieferanten mit Wareneingang. Wareneingang bucht Lagerartikel atomar zusammen mit den
// gelieferten Mengen (eine Transaktion). Automatik: erste Bestellung eines Projekts → Phase Materialbeschaffung läuft;
// alles geliefert → Beschaffung erledigt; Wareneingang für ein Projekt mit „Material fehlt“ → Push an Werkstatt/Projektleiter.

export class OrderError extends Error {}
type Actor = { id: string; name: string };

/** Lagerartikel per Name finden (für die Zuordnung der Positionen) */
async function matchStock(text: string, supplierId: string) {
  const t = text.trim();
  const exact = await db.stockItem.findFirst({ where: { name: { equals: t, mode: "insensitive" } }, select: { id: true, price: true } });
  if (exact) return exact;
  return db.stockItem.findFirst({ where: { supplierId, name: { contains: t.split(/\s+/).slice(0, 3).join(" "), mode: "insensitive" } }, select: { id: true, price: true } });
}

export async function createSupplierOrder(i: { supplierId: string; projectId?: string | null; requestId?: string | null; positions: string; expectedAt?: Date | null; supplierRef?: string | null; note?: string | null }, user: Actor) {
  const sup = await db.supplier.findUnique({ where: { id: i.supplierId }, select: { id: true } });
  if (!sup) throw new OrderError("Lieferant nicht gefunden.");
  if (i.projectId && !(await db.project.findUnique({ where: { id: i.projectId }, select: { id: true } }))) throw new OrderError("Projekt nicht gefunden.");
  const lines: BeLine[] = [];
  for (const raw of i.positions.split(/\r?\n/).filter((l) => l.trim()).slice(0, 60)) {
    // Preis optional am Ende: „… à 8,50“ / „… je 8,50 €“ / „… @ 8.5“
    const pm = raw.match(/\s(?:à|a|je|@)\s*(\d+(?:[.,]\d+)?)\s*€?\s*$/i);
    const p = parsePositions(pm ? raw.slice(0, pm.index) : raw)[0];
    if (!p) continue;
    const st = await matchStock(p.text, sup.id);
    lines.push({ text: p.text, qty: p.menge ?? 1, unit: p.einheit ?? null, price: pm ? Number(pm[1].replace(",", ".")) : (st?.price ?? null), stockItemId: st?.id ?? null, received: 0 });
  }
  if (!lines.length) throw new OrderError("Mindestens eine Position angeben (eine Zeile je Position, z. B. „12 Stk Rohr 40×40×3 S235 6 m à 8,50“).");
  const year = berlinParts().y;
  const o = await db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `BESTELLUNG-${year}`);
    return tx.supplierOrder.create({
      data: { number: `BE-${year}-${String(n).padStart(4, "0")}`, supplierId: sup.id, projectId: i.projectId ?? null, requestId: i.requestId ?? null, lines, totalNet: total(lines), expectedAt: i.expectedAt ?? null, supplierRef: i.supplierRef ?? null, note: i.note ?? null, createdBy: user.name },
    });
  });
  if (i.requestId) await db.supplierRequest.updateMany({ where: { id: i.requestId }, data: { status: "BESTELLT" } });
  if (o.projectId) {
    const ph = await db.projectPhase.findFirst({ where: { projectId: o.projectId, key: "BESCHAFFUNG" }, select: { status: true } });
    if (!ph || ph.status === "OFFEN") await setPhase({ projectId: o.projectId, key: "BESCHAFFUNG", status: "LAEUFT", userName: `${user.name} (Automatik)` }).catch(() => {});
  }
  return o;
}

const total = (lines: BeLine[]) => Math.round(lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0) * 100) / 100;

/** Bestellung aus einer Preisanfrage (Positionen übernehmen, Angebotssumme als Hinweis) */
export async function orderFromRequest(requestId: string, user: Actor) {
  const r = await db.supplierRequest.findUnique({ where: { id: requestId }, include: { orders: { select: { id: true } } } });
  if (!r) throw new OrderError("Preisanfrage nicht gefunden.");
  if (r.orders.length) return db.supplierOrder.findUniqueOrThrow({ where: { id: r.orders[0].id } });
  const pos = (Array.isArray(r.positions) ? r.positions : []) as { menge?: number | null; einheit?: string | null; text: string }[];
  const text = pos.map((p) => [p.menge, p.einheit, p.text].filter(Boolean).join(" ")).join("\n");
  return createSupplierOrder({ supplierId: r.supplierId, projectId: r.projectId, requestId: r.id, positions: text, note: r.offerAmount ? `Angebot ${r.offerAmount.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}${r.offerNote ? ` – ${r.offerNote}` : ""}` : null }, user);
}

/**
 * Wareneingang: gelieferte Mengen je Position (Index). Lagerartikel bekommen einen Zugang (mit Preis der Bestellung),
 * alles in einer Transaktion. Mehr als bestellt geht nicht (Überlieferung bitte als neue Position erfassen).
 */
export async function receiveGoods(orderId: string, input: { lines: { index: number; qty: number; stockItemId?: string | null }[]; slipNo?: string | null; note?: string | null; fileId?: string | null }, user: Actor) {
  const res = await db.$transaction(async (tx) => {
    const o = await tx.supplierOrder.findUnique({ where: { id: orderId }, include: { supplier: { select: { name: true } } } });
    if (!o) throw new OrderError("Bestellung nicht gefunden.");
    if (o.status === "STORNIERT" || o.status === "GELIEFERT") throw new OrderError(`Die Bestellung ist ${BE_LABEL[o.status as BeStatus].toLowerCase()}.`);
    const lines = readLines(o.lines);
    const booked: { index: number; qty: number; stockItemId: string | null }[] = [];
    for (const r of input.lines) {
      const l = lines[r.index];
      if (!l || !(r.qty > 0)) continue;
      if (r.qty > openQty(l) + 1e-9) throw new OrderError(`Position ${r.index + 1}: höchstens ${fmtNum(openQty(l))} offen.`);
      const stockItemId = r.stockItemId === undefined ? l.stockItemId : r.stockItemId;
      if (stockItemId) {
        const item = await tx.stockItem.findUnique({ where: { id: stockItemId }, select: { id: true } });
        if (!item) throw new OrderError(`Position ${r.index + 1}: Lagerartikel nicht gefunden.`);
        await tx.stockItem.update({ where: { id: item.id }, data: { quantity: { increment: r.qty }, ...(l.price ? { price: l.price } : {}) } });
        await tx.stockMove.create({ data: { itemId: item.id, kind: "EINGANG", delta: r.qty, price: l.price, projectId: null, note: `Wareneingang ${o.number} (${o.supplier.name})${input.slipNo ? `, Lieferschein ${input.slipNo}` : ""}`, userName: user.name } });
      }
      lines[r.index] = { ...l, received: Math.round((l.received + r.qty) * 1000) / 1000, stockItemId };
      booked.push({ index: r.index, qty: r.qty, stockItemId });
    }
    if (!booked.length) throw new OrderError("Keine gelieferte Menge eingetragen.");
    const done = lines.every((l) => openQty(l) === 0);
    // atomar gegen gleichzeitige Wareneingänge: nur, wenn sich die Bestellung seit dem Lesen nicht geändert hat
    const u = await tx.supplierOrder.updateMany({ where: { id: o.id, updatedAt: o.updatedAt }, data: { lines, status: done ? "GELIEFERT" : "TEILGELIEFERT", deliveredAt: done ? new Date() : null } });
    if (!u.count) throw new OrderError("Die Bestellung wurde gerade geändert – bitte neu laden.");
    await tx.goodsReceipt.create({ data: { orderId: o.id, lines: booked, slipNo: input.slipNo ?? null, note: input.note ?? null, fileId: input.fileId ?? null, userName: user.name } });
    return { order: o, done, booked };
  });
  const { order: o, done } = res;
  if (o.projectId) {
    const project = await db.project.findUnique({ where: { id: o.projectId }, select: { id: true, name: true, leaderId: true } });
    if (done) {
      const open = await db.supplierOrder.count({ where: { projectId: o.projectId, status: { in: ["BESTELLT", "TEILGELIEFERT"] } } });
      if (open === 0) await setPhase({ projectId: o.projectId, key: "BESCHAFFUNG", status: "ERLEDIGT", userName: `${user.name} (Automatik)` }).catch(() => {});
    }
    // Werkstatt wartet auf Material → Bescheid geben
    const waiting = await db.productionJob.findMany({ where: { projectId: o.projectId, status: "MATERIAL_FEHLT" }, select: { id: true, number: true, title: true, assigneeId: true } });
    const targets = new Set([...waiting.map((j) => j.assigneeId), project?.leaderId].filter((x): x is string => Boolean(x)));
    if (waiting.length && project) for (const userId of targets) await sendPush({ title: "📦 Material eingetroffen", body: `${project.name}: ${o.number} ${done ? "komplett" : "teilweise"} geliefert – ${waiting.map((j) => j.number).join(", ")} wartet auf Material.`, url: waiting.length === 1 ? `/fertigung/${waiting[0].id}` : "/fertigung", tag: `wareneingang-${o.id}`, userId });
  }
  return res;
}

export function orderLine(o: { id: string; number: string; status: string; totalNet: number; orderedAt: Date; expectedAt: Date | null; supplier: { name: string }; project?: { name: string } | null; lines: unknown }) {
  const lines = readLines(o.lines);
  const open = lines.filter((l) => openQty(l) > 0).length;
  return `- ${o.number} · ${o.supplier.name}${o.project ? ` · ${o.project.name}` : ""} · ${BE_LABEL[o.status as BeStatus] ?? o.status}${open && o.status !== "STORNIERT" ? ` (${open} Pos. offen)` : ""} · ${o.totalNet ? o.totalNet.toLocaleString("de-DE", { style: "currency", currency: "EUR" }) : "ohne Preis"} · bestellt ${formatDate(o.orderedAt)}${o.expectedAt ? ` · Liefertermin ${formatDate(o.expectedAt)}` : ""} · id ${o.id}`;
}
