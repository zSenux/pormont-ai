import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { ensurePhases, setPhase } from "@/lib/phases";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders-shared";

// Kundenakte (CRM): Kontakthistorie, Notizen, Wiedervorlagen und neue Kundenanfragen.
// Stammdaten, Angebote und Rechnungen gehören der Buchhaltung (Customer, SalesDoc) – hier nur ergänzt.

export const NOTE_KIND_LABEL = { NOTIZ: "Notiz", ANRUF: "Anruf", MAIL: "E-Mail", TERMIN: "Termin", BESUCH: "Besuch" } as const;
export type NoteKind = keyof typeof NOTE_KIND_LABEL;
export const NOTE_KINDS = Object.keys(NOTE_KIND_LABEL) as [NoteKind, ...NoteKind[]];

export class CrmError extends Error {}

export async function addNote(input: { customerId: string; kind: NoteKind; text: string; followUp?: string | null; assigneeId?: string | null; authorName: string }) {
  return db.customerNote.create({
    data: { customerId: input.customerId, kind: input.kind, text: input.text, followUpAt: input.followUp ? berlinDateTime(input.followUp) : null, assigneeId: input.assigneeId ?? null, authorName: input.authorName },
  });
}

/** Neue Kundenanfrage = Projekt in Phase „Kundenanfrage“ mit Bezug zum Kunden (wird später zum Auftrag) */
export async function newInquiry(input: { customerId: string; title: string; description?: string | null; address?: string | null; userId: string; userName: string }) {
  const c = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!c) throw new CrmError("Kunde nicht gefunden.");
  const address = input.address ?? ([c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null);
  const p = await db.project.create({ data: { name: input.title, customer: c.name, customerId: c.id, address, description: input.description ?? null, status: "PLANUNG", leaderId: input.userId, createdById: input.userId } });
  await ensurePhases(p.id);
  await setPhase({ projectId: p.id, key: "ANFRAGE", status: "LAEUFT", userName: input.userName });
  await db.customerNote.create({ data: { customerId: c.id, kind: "NOTIZ", text: `Neue Anfrage: ${input.title}${input.description ? ` – ${input.description}` : ""}`, authorName: input.userName } });
  return p;
}

/** Fällige Wiedervorlagen (bis einschließlich `until`) */
export function dueFollowUps(until: Date, take = 30) {
  return db.customerNote.findMany({
    where: { followUpDone: null, followUpAt: { lte: until } },
    orderBy: { followUpAt: "asc" },
    take,
    include: { customer: { select: { id: true, name: true } }, assignee: { select: { name: true } } },
  });
}

/** Kundenakte als Text für Jarvis */
export async function customerFileText(customerId: string) {
  const c = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      crmNotes: { orderBy: { createdAt: "desc" }, take: 15, include: { assignee: { select: { name: true } } } },
      orders: { orderBy: { createdAt: "desc" }, take: 10 },
      projects: { orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, name: true, status: true, order: { select: { id: true } } } },
      docs: { orderBy: { date: "desc" }, take: 10, select: { kind: true, number: true, status: true, grossCents: true, date: true } },
    },
  });
  if (!c) return "Kunde nicht gefunden.";
  const inquiries = c.projects.filter((p) => !p.order && p.status !== "FERTIG");
  return [
    `Kundenakte ${c.name}${c.number ? ` (Nr. ${c.number})` : ""}`,
    [c.contactName && `Ansprechpartner ${c.contactName}`, c.phone, c.email, [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    `Offene Wiedervorlagen: ${c.crmNotes.filter((n) => n.followUpAt && !n.followUpDone).map((n) => `${formatDate(n.followUpAt)} „${n.text.slice(0, 80)}“${n.assignee ? ` (${n.assignee.name})` : ""} · id ${n.id}`).join("; ") || "keine"}`,
    `Anfragen ohne Auftrag: ${inquiries.map((p) => `${p.name} (Projekt-ID ${p.id})`).join("; ") || "keine"}`,
    `Aufträge: ${c.orders.map((o) => `${o.number} ${o.title} ${fmtEuroCents(o.valueCents)} ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}`).join("; ") || "keine"}`,
    `Belege: ${c.docs.map((d) => `${d.kind} ${d.number ?? "Entwurf"} ${formatDate(d.date)} ${fmtEuroCents(d.grossCents)} ${d.status}`).join("; ") || "keine"}`,
    "Kontakthistorie (neueste zuerst):",
    ...c.crmNotes.map((n) => `- ${formatDate(n.createdAt)} ${NOTE_KIND_LABEL[n.kind as NoteKind] ?? n.kind}${n.authorName ? ` (${n.authorName})` : ""}: ${n.text}`),
    `[Kundenakte öffnen](/buchhaltung/kunden/${c.id})`,
  ].filter(Boolean).join("\n");
}
