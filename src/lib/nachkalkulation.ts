import "server-only";
import { db } from "@/lib/db";

// Nachkalkulation je Projekt: Auftragswert (Lexware-Angebot bzw. von Hand) gegen die echten Kosten:
// Stunden × Kosten-Stundensatz, Material aus dem Lager (Entnahmen zum EK), bestellte Lieferanten-Angebote,
// Spesen (ohne abgelehnte) und sonstige Kosten (Fremdleistung, Gerät …). Alles netto.

export const defaultHourlyRate = () => {
  const n = Number(String(process.env.KALK_STUNDENSATZ ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 55;
};

export const COST_KINDS = ["MATERIAL", "FREMDLEISTUNG", "GERAET", "SONSTIGES"] as const;
export const COST_LABEL: Record<string, string> = { MATERIAL: "Material", FREMDLEISTUNG: "Fremdleistung", GERAET: "Gerät/Miete", SONSTIGES: "Sonstiges" };

export type Calc = Awaited<ReturnType<typeof calcProject>>;

export async function calcProject(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const [times, moves, orders, expenses, costs] = await Promise.all([
    db.timeEntry.findMany({ where: { projectId, kind: { in: ["ARBEIT", "FAHRT"] } }, select: { minutes: true, user: { select: { name: true } } } }),
    db.stockMove.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, include: { item: { select: { name: true, unit: true } } } }),
    db.supplierRequest.findMany({ where: { projectId, status: "BESTELLT", offerAmount: { not: null } }, include: { supplier: { select: { name: true } } } }),
    db.expense.findMany({ where: { projectId, status: { not: "ABGELEHNT" } }, select: { amountCents: true, kind: true, description: true } }),
    db.projectCost.findMany({ where: { projectId }, orderBy: { day: "desc" } }),
  ]);
  const rate = p.hourlyRate ?? defaultHourlyRate();
  const minutes = times.reduce((s, t) => s + t.minutes, 0);
  const byUser = [...times.reduce((m, t) => m.set(t.user.name, (m.get(t.user.name) ?? 0) + t.minutes), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const labor = Math.round((minutes / 60) * rate * 100) / 100;
  // Entnahme = negatives delta; Rückgabe aufs Lager (positiv mit Projekt) mindert die Kosten
  const materialLines = moves.map((m) => ({ id: m.id, name: m.item.name, qty: -m.delta, unit: m.item.unit, price: m.price, amount: Math.round(-m.delta * (m.price ?? 0) * 100) / 100, day: m.createdAt, missingPrice: m.price === null }));
  const material = materialLines.reduce((s, l) => s + l.amount, 0);
  const supplier = orders.reduce((s, o) => s + (o.offerAmount ?? 0), 0);
  const spesen = expenses.reduce((s, e) => s + e.amountCents, 0) / 100;
  const extra = costs.reduce((s, c) => s + c.amount, 0);
  const total = labor + material + supplier + spesen + extra;
  const revenue = p.budgetNet;
  const margin = revenue !== null ? revenue - total : null;
  return {
    project: p,
    revenue,
    rate,
    minutes,
    byUser,
    labor,
    material,
    materialLines,
    supplier,
    orders: orders.map((o) => ({ id: o.id, supplier: o.supplier.name, subject: o.subject, amount: o.offerAmount ?? 0 })),
    spesen,
    expenseCount: expenses.length,
    extra,
    costs,
    total,
    margin,
    marginPct: revenue ? (margin! / revenue) * 100 : null,
    /** Anteil der Kosten am Auftragswert (für den Balken) */
    used: revenue ? total / revenue : null,
  };
}

/** Kurztext für Jarvis */
export function calcText(c: Calc) {
  const e = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const h = (c.minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return [
    `Nachkalkulation „${c.project.name}“ (netto):`,
    `Auftragswert: ${c.revenue !== null ? e(c.revenue) + (c.project.lexQuotationNo ? ` (Angebot ${c.project.lexQuotationNo})` : "") : "nicht hinterlegt"}`,
    `Lohn: ${h} Std. × ${e(c.rate)} = ${e(c.labor)}${c.byUser.length ? ` (${c.byUser.map(([n, m]) => `${n} ${(m / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Std.`).join(", ")})` : ""}`,
    `Material aus Lager: ${e(c.material)}${c.materialLines.some((l) => l.missingPrice) ? " (teils ohne Einkaufspreis!)" : ""}`,
    `Bestellte Lieferanten-Angebote: ${e(c.supplier)}`,
    `Spesen: ${e(c.spesen)} · Sonstige Kosten: ${e(c.extra)}`,
    `Kosten gesamt: ${e(c.total)}`,
    c.margin !== null ? `Ergebnis: ${e(c.margin)} (${c.marginPct!.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % vom Auftragswert)` : "Ergebnis: ohne Auftragswert nicht berechenbar.",
    `[Nachkalkulation öffnen](/projekte/${c.project.id}/nachkalkulation)`,
  ].join("\n");
}
