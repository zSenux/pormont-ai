import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate } from "@/lib/berlin";
import { nextSequence, type Actor } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { ensurePhases, currentPhase, phaseTitle, progressOf } from "@/lib/phases";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders-shared";

// Aufträge (EPS): Ein Auftrag entsteht aus einem angenommenen Angebot (automatisch) oder von Hand.
// Jeder Auftrag hat genau eine Projektakte (Project) – dort liegen Phasen, Team, Stunden, Dokumente, Nachkalkulation.
// Nummer AU-<Jahr>-0001 aus dem gemeinsamen Nummernkreis (NumberSeq, Key „AUFTRAG-<Jahr>“).

export { ORDER_STATUS_LABEL, type OrderStatus };
export class OrderError extends Error {}

/** Phasen bis zur Auftragserteilung als erledigt markieren, Auftragserteilung erledigt → Projekt läuft */
async function markOrdered(projectId: string, userName: string) {
  await ensurePhases(projectId);
  await db.projectPhase.updateMany({ where: { projectId, key: { in: ["ANFRAGE", "ANGEBOT", "AUFTRAG"] }, status: { in: ["OFFEN", "LAEUFT"] } }, data: { status: "ERLEDIGT", doneAt: new Date(), doneByName: userName } });
  await db.project.updateMany({ where: { id: projectId, status: { in: ["PLANUNG", "PAUSIERT"] } }, data: { status: "LAEUFT" } });
}

/**
 * Auftrag aus einem Angebot anlegen (idempotent: gibt es schon einen Auftrag zum Angebot, kommt dieser zurück).
 * Übernimmt Kunde, Projekt (oder legt die Projektakte an), Auftragswert und Positionen als Materialbedarf-Vorlage.
 */
export async function createOrderFromQuote(quoteId: string, user: Actor) {
  const existing = await db.order.findFirst({ where: { quoteId } });
  if (existing) return { order: existing, created: false };
  const q = await db.salesDoc.findUnique({ where: { id: quoteId }, include: { customer: true } });
  if (!q || q.kind !== "ANGEBOT") throw new OrderError("Angebot nicht gefunden.");
  if (q.status === "ENTWURF") throw new OrderError("Das Angebot ist noch ein Entwurf – erst festschreiben, dann als angenommen markieren.");
  if (q.status === "ABGELEHNT") throw new OrderError("Das Angebot ist abgelehnt.");
  const year = berlinParts().y;
  const title = q.title?.trim() || `Auftrag ${q.customer?.name ?? ""}`.trim();
  const address = q.customer ? [q.customer.street, [q.customer.zip, q.customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null : null;

  const order = await db.$transaction(async (tx) => {
    // Doppelklick/zweiter Aufruf: innerhalb der Transaktion noch einmal prüfen
    const again = await tx.order.findFirst({ where: { quoteId } });
    if (again) return again;
    let projectId = q.projectId;
    if (projectId && (await tx.order.findUnique({ where: { projectId } }))) projectId = null; // Projekt hat schon einen Auftrag → neue Akte
    if (projectId) {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      await tx.project.update({ where: { id: projectId }, data: { customerId: p.customerId ?? q.customerId, customer: p.customer ?? q.customer?.name ?? null, budgetNet: p.budgetNet ?? q.netCents / 100, address: p.address ?? address } });
    } else {
      const p = await tx.project.create({ data: { name: title, customer: q.customer?.name ?? null, customerId: q.customerId, address, status: "LAEUFT", budgetNet: q.netCents / 100, leaderId: user.id, createdById: user.id } });
      projectId = p.id;
      await tx.salesDoc.update({ where: { id: q.id }, data: { projectId } });
    }
    const n = await nextSequence(tx, `AUFTRAG-${year}`);
    return tx.order.create({
      data: { number: `AU-${year}-${String(n).padStart(4, "0")}`, title, customerId: q.customerId, quoteId: q.id, projectId, valueCents: q.netCents, startDate: berlinDateTime(berlinParts().ymd), status: "NEU", createdById: user.id, createdBy: user.name },
    });
  });
  if (q.status === "OFFEN") await db.salesDoc.updateMany({ where: { id: q.id, status: "OFFEN" }, data: { status: "ANGENOMMEN" } });
  await db.salesDocEvent.create({ data: { docId: q.id, text: `Auftrag ${order.number} angelegt`, userName: user.name } });
  await markOrdered(order.projectId, user.name);
  return { order, created: true };
}

/** Auftrag ohne Angebot (z. B. Telefonauftrag, Kleinauftrag) – legt die Projektakte mit an */
export async function createOrder(input: { title: string; customerId?: string | null; valueCents?: number; start?: string | null; due?: string | null; address?: string | null; customerRef?: string | null; leaderId?: string | null }, user: Actor) {
  const year = berlinParts().y;
  const customer = input.customerId ? await db.customer.findUnique({ where: { id: input.customerId } }) : null;
  const order = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: { name: input.title, customer: customer?.name ?? null, customerId: customer?.id ?? null, address: input.address ?? null, status: "LAEUFT", budgetNet: input.valueCents ? input.valueCents / 100 : null, startDate: input.start ? berlinDateTime(input.start) : null, endDate: input.due ? berlinDateTime(input.due) : null, leaderId: input.leaderId ?? user.id, createdById: user.id },
    });
    const n = await nextSequence(tx, `AUFTRAG-${year}`);
    return tx.order.create({
      data: { number: `AU-${year}-${String(n).padStart(4, "0")}`, title: input.title, customerId: customer?.id ?? null, projectId: p.id, valueCents: input.valueCents ?? 0, startDate: input.start ? berlinDateTime(input.start) : null, dueDate: input.due ? berlinDateTime(input.due) : null, customerRef: input.customerRef ?? null, createdById: user.id, createdBy: user.name },
    });
  });
  await markOrdered(order.projectId, user.name);
  return order;
}

/** Wird von der Buchhaltung aufgerufen, wenn ein Angebot angenommen wird (Automatik „Angebot angenommen → Auftrag“). Fehler blockieren die Buchhaltung nie. */
export async function onQuoteAccepted(quoteId: string, user: Actor) {
  try {
    return (await createOrderFromQuote(quoteId, user)).order;
  } catch (e) {
    console.error("[auftrag] Automatik nach Angebotsannahme fehlgeschlagen:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Kurztext für Jarvis */
export async function orderText(id: string) {
  const o = await db.order.findUnique({
    where: { id },
    include: { customer: { select: { name: true } }, quote: { select: { id: true, number: true } }, project: { include: { leader: { select: { name: true } }, phases: { select: { key: true, status: true, sort: true } }, members: { include: { user: { select: { name: true } } } } } } },
  });
  if (!o) return "Auftrag nicht gefunden.";
  const cur = currentPhase(o.project.phases);
  return [
    `Auftrag ${o.number} „${o.title}“ · ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}`,
    `Kunde: ${o.customer?.name ?? o.project.customer ?? "–"} · Auftragswert netto ${fmtEuroCents(o.valueCents)}${o.quote ? ` · aus Angebot ${o.quote.number ?? "(Entwurf)"}` : ""}`,
    `Beginn ${o.startDate ? formatDate(o.startDate) : "–"} · Fertigstellung ${o.dueDate ? formatDate(o.dueDate) : "offen"}${o.dueDate && o.dueDate < new Date() && o.status !== "ABGESCHLOSSEN" ? " ⚠ überschritten" : ""}`,
    `Projektleiter: ${o.project.leader?.name ?? "–"} · Team: ${o.project.members.map((m) => m.user.name).join(", ") || "–"}`,
    `Fortschritt ${progressOf(o.project.phases)} %${cur ? ` · Phase: ${phaseTitle(cur.key)}` : ""}`,
    o.customerRef && `Zeichen/Bestellnr. des Kunden: ${o.customerRef}`,
    o.material && `Materialbedarf: ${o.material}`,
    o.production && `Fertigungsinfos: ${o.production}`,
    o.notes && `Notizen: ${o.notes}`,
    `[Auftrag öffnen](/auftraege/${o.id}) · [Projektakte](/projekte/${o.projectId}) · id ${o.id} · Projekt-ID ${o.projectId}`,
  ].filter(Boolean).join("\n");
}
