import "server-only";
import { db } from "@/lib/db";
import { createRequest } from "@/lib/suppliers";

// Materiallager: Bestand je Artikel, jede Änderung als Buchung (StockMove). Ausgänge auf ein Projekt
// fließen mit dem Einkaufspreis zum Buchungszeitpunkt in die Nachkalkulation.

export const STOCK_CATEGORIES = ["PROFIL", "ROHR", "BLECH", "FLACH_RUND", "SCHRAUBEN", "BESCHLAG", "VERBRAUCH", "SONSTIGES"] as const;
export type StockCategory = (typeof STOCK_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<StockCategory, string> = {
  PROFIL: "Träger & Profile",
  ROHR: "Rohre",
  BLECH: "Bleche",
  FLACH_RUND: "Flach-, Rund-, Vierkantstahl",
  SCHRAUBEN: "Schrauben & Dübel",
  BESCHLAG: "Beschläge & Schlosserteile",
  VERBRAUCH: "Verbrauch (Gas, Draht, Scheiben)",
  SONSTIGES: "Sonstiges",
};
export const MOVE_LABEL: Record<string, string> = { EINGANG: "Eingang", AUSGANG: "Entnahme", INVENTUR: "Inventur" };

export class StockError extends Error {}

export const fmtQty = (n: number, unit?: string | null) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
export const isLow = (i: { quantity: number; minQuantity: number | null }) => i.minQuantity !== null && i.quantity <= i.minQuantity;

/** Buchen: EINGANG (+menge, optional neuer Preis), AUSGANG (−menge, meist auf Projekt), INVENTUR (Bestand auf menge setzen) */
export async function bookStock(o: { itemId: string; kind: "EINGANG" | "AUSGANG" | "INVENTUR"; qty: number; projectId?: string | null; price?: number | null; note?: string | null; userName: string; allowNegative?: boolean }) {
  if (!(o.qty >= 0) || o.qty > 1_000_000) throw new StockError("Menge prüfen.");
  if (o.kind !== "INVENTUR" && o.qty === 0) throw new StockError("Menge prüfen.");
  return db.$transaction(async (tx) => {
    const item = await tx.stockItem.findUnique({ where: { id: o.itemId } });
    if (!item) throw new StockError("Lagerartikel nicht gefunden.");
    if (o.projectId && !(await tx.project.findUnique({ where: { id: o.projectId }, select: { id: true } }))) throw new StockError("Projekt nicht gefunden.");
    const delta = o.kind === "EINGANG" ? o.qty : o.kind === "AUSGANG" ? -o.qty : o.qty - item.quantity;
    if (o.kind === "AUSGANG" && item.quantity + delta < 0 && !o.allowNegative) throw new StockError(`Nur noch ${fmtQty(item.quantity, item.unit)} auf Lager.`);
    const price = o.kind === "EINGANG" && o.price !== undefined && o.price !== null ? o.price : item.price;
    // Bestand atomar ändern (gleichzeitige Buchungen gehen nicht verloren)
    const updated = await tx.stockItem.update({ where: { id: item.id }, data: { quantity: { increment: delta }, ...(o.kind === "EINGANG" && o.price ? { price: o.price } : {}) } });
    await tx.stockMove.create({ data: { itemId: item.id, kind: o.kind, delta, price, projectId: o.projectId || null, note: o.note || null, userName: o.userName } });
    return { item: updated, delta };
  });
}

export function lowStock(take = 50) {
  return db.$queryRaw<{ id: string }[]>`SELECT id FROM "StockItem" WHERE "minQuantity" IS NOT NULL AND quantity <= "minQuantity" LIMIT ${take}`.then((rows) =>
    rows.length ? db.stockItem.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { name: "asc" }, include: { supplier: { select: { id: true, name: true, email: true } } } }) : [],
  );
}

/** Nachbestellen = Preisanfrage-Entwurf beim hinterlegten Lieferanten (gesendet wird erst nach Klick/Freigabe) */
export async function reorderRequest(itemId: string, user: { id: string; name: string }, qty?: number) {
  const item = await db.stockItem.findUnique({ where: { id: itemId } });
  if (!item) throw new StockError("Lagerartikel nicht gefunden.");
  if (!item.supplierId) throw new StockError("Für diesen Artikel ist kein Lieferant hinterlegt.");
  const menge = qty ?? item.reorderQty ?? Math.max(1, (item.minQuantity ?? 0) * 2 - item.quantity);
  const text = [item.name, item.material, item.articleNo ? `Art.-Nr. ${item.articleNo}` : null].filter(Boolean).join(", ");
  return createRequest({ supplierId: item.supplierId, positions: [{ menge, einheit: item.unit, text }], note: "Nachbestellung für unser Lager.", user });
}
