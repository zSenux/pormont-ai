import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate, formatDateTime } from "@/lib/berlin";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { setPhase } from "@/lib/phases";
import { sendPush } from "@/lib/push";
import { ASM_STATUS_LABEL, DEFAULT_CHECKLIST, readChecklist, readDefects, type AsmStatus } from "@/lib/assembly-shared";

// Montageplanung: Montagen (MO-<Jahr>-0001) mit Termin (Kalender), Team, Fahrzeug, Plan, Checkliste, Fotos vorher/nachher,
// Bericht, Mängeln und Abnahme mit digitaler Unterschrift.
// Automatik: Montage läuft → Phase Montage läuft; Montage erledigt → Phase Montage erledigt, Abnahme läuft, Abnahmeprotokoll bereit;
// Abnahme unterschrieben → Phase Abnahme erledigt, Rechnungsstellung läuft, Projektleiter bekommt Push „Schlussrechnung stellen“.

export class AssemblyError extends Error {}
type Actor = { id: string; name: string };

export type AssemblyInput = { projectId: string; title: string; date: string; from?: string | null; to?: string | null; days?: number | null; address?: string | null; vehicle?: string | null; leaderId?: string | null; crewIds?: string[]; plan?: string | null };

function times(i: AssemblyInput) {
  const startAt = berlinDateTime(i.date, i.from ?? "07:00");
  const endAt = i.days && i.days > 1 ? berlinDateTime(new Date(startAt.getTime() + (i.days - 1) * 86400_000).toISOString().slice(0, 10), i.to ?? "16:00") : i.to ? berlinDateTime(i.date, i.to) : null;
  return { startAt, endAt };
}

async function syncEvent(id: string) {
  const a = await db.assembly.findUnique({ where: { id }, include: { crew: { include: { user: { select: { name: true } } } } } });
  if (!a) return;
  const data = { title: `Montage: ${a.title}`, startAt: a.startAt, endAt: a.endAt, allDay: false, location: a.address, projectId: a.projectId, notes: [a.number, a.crew.length ? `Team: ${a.crew.map((c) => c.user.name).join(", ")}` : null, a.vehicle ? `Fahrzeug: ${a.vehicle}` : null].filter(Boolean).join("\n"), remindMinutes: 60 };
  if (a.status === "ABGESAGT") {
    if (a.eventId) await db.event.deleteMany({ where: { id: a.eventId } });
    await db.assembly.update({ where: { id }, data: { eventId: null } });
    return;
  }
  const ev = a.eventId ? await db.event.findUnique({ where: { id: a.eventId } }) : null;
  if (ev) await db.event.update({ where: { id: ev.id }, data: { ...data, reminderSentAt: ev.startAt.getTime() === a.startAt.getTime() ? ev.reminderSentAt : null } });
  else {
    const e = await db.event.create({ data });
    await db.assembly.update({ where: { id }, data: { eventId: e.id } });
  }
}

export async function createAssembly(i: AssemblyInput, user: Actor) {
  const p = await db.project.findUnique({ where: { id: i.projectId }, select: { id: true, address: true } });
  if (!p) throw new AssemblyError("Projekt nicht gefunden.");
  const year = berlinParts().y;
  const { startAt, endAt } = times(i);
  const a = await db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `MONTAGE-${year}`);
    return tx.assembly.create({
      data: {
        number: `MO-${year}-${String(n).padStart(4, "0")}`,
        projectId: p.id,
        title: i.title,
        startAt,
        endAt,
        address: i.address ?? p.address,
        vehicle: i.vehicle ?? null,
        leaderId: i.leaderId ?? null,
        plan: i.plan ?? null,
        checklist: DEFAULT_CHECKLIST.map((text) => ({ text, done: false })),
        createdBy: user.name,
        crew: { create: [...new Set(i.crewIds ?? [])].map((userId) => ({ userId })) },
      },
    });
  });
  await syncEvent(a.id);
  return a;
}

export async function updateAssembly(id: string, i: AssemblyInput) {
  const { startAt, endAt } = times(i);
  await db.$transaction([
    db.assembly.update({ where: { id }, data: { title: i.title, startAt, endAt, address: i.address ?? null, vehicle: i.vehicle ?? null, leaderId: i.leaderId ?? null, plan: i.plan ?? null } }),
    db.assemblyMember.deleteMany({ where: { assemblyId: id } }),
    db.assemblyMember.createMany({ data: [...new Set(i.crewIds ?? [])].map((userId) => ({ assemblyId: id, userId })) }),
  ]);
  await syncEvent(id);
}

export async function setAssemblyStatus(id: string, status: AsmStatus, user: Actor) {
  const a = await db.assembly.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, leaderId: true } } } });
  if (!a) throw new AssemblyError("Montage nicht gefunden.");
  if (status === "ABGENOMMEN" && !a.signedAt) throw new AssemblyError("Abgenommen wird mit der Unterschrift des Kunden im Abnahmeprotokoll.");
  await db.assembly.update({ where: { id }, data: { status, doneAt: status === "ERLEDIGT" ? (a.doneAt ?? new Date()) : status === "GEPLANT" || status === "LAEUFT" ? null : a.doneAt } });
  if (status === "LAEUFT") await setPhase({ projectId: a.projectId, key: "MONTAGE", status: "LAEUFT", userName: user.name }).catch(() => {});
  if (status === "ERLEDIGT") {
    const open = await db.assembly.count({ where: { projectId: a.projectId, status: { in: ["GEPLANT", "LAEUFT"] } } });
    if (open === 0) {
      await setPhase({ projectId: a.projectId, key: "MONTAGE", status: "ERLEDIGT", userName: user.name }).catch(() => {});
      await setPhase({ projectId: a.projectId, key: "ABNAHME", status: "LAEUFT", userName: `${user.name} (Automatik)` }).catch(() => {});
    }
    await sendPush({ title: "Montage erledigt", body: `${a.project.name}: Abnahmeprotokoll ist vorbereitet – Kunde kann unterschreiben.`, url: `/montage/${a.id}/protokoll`, tag: `montage-${a.id}`, ...(a.project.leaderId ? { userId: a.project.leaderId } : {}) });
  }
  if (status === "ABGESAGT") await syncEvent(id);
}

/** Abnahme: Unterschrift des Kunden (PNG als Data-URL) → abgenommen + Automatik */
export async function signAcceptance(id: string, input: { signerName: string; signature: string; note?: string | null }, user: Actor) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.signature) || input.signature.length > 400_000) throw new AssemblyError("Unterschrift ungültig – bitte noch einmal unterschreiben.");
  const a = await db.assembly.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, leaderId: true } } } });
  if (!a) throw new AssemblyError("Montage nicht gefunden.");
  if (a.signedAt) throw new AssemblyError("Die Abnahme ist schon unterschrieben.");
  const r = await db.assembly.updateMany({ where: { id, signedAt: null }, data: { signerName: input.signerName, signatureData: input.signature, signedAt: new Date(), acceptanceNote: input.note ?? null, status: "ABGENOMMEN", doneAt: a.doneAt ?? new Date() } });
  if (!r.count) throw new AssemblyError("Die Abnahme ist schon unterschrieben.");
  await setPhase({ projectId: a.projectId, key: "MONTAGE", status: "ERLEDIGT", userName: user.name }).catch(() => {});
  await setPhase({ projectId: a.projectId, key: "ABNAHME", status: "ERLEDIGT", userName: `${input.signerName} (Unterschrift)` }).catch(() => {});
  await setPhase({ projectId: a.projectId, key: "RECHNUNG", status: "LAEUFT", userName: `${user.name} (Automatik)` }).catch(() => {});
  await db.projectNote.create({ data: { projectId: a.projectId, text: `Abnahme ${a.number} unterschrieben von ${input.signerName}${input.note ? ` – Vorbehalte: ${input.note}` : ""}.`, authorName: user.name } });
  await sendPush({ title: "Abnahme unterschrieben", body: `${a.project.name}: abgenommen von ${input.signerName}. Schlussrechnung stellen.`, url: `/montage/${a.id}/protokoll`, tag: `abnahme-${a.id}`, ...(a.project.leaderId ? { userId: a.project.leaderId } : {}) });
}

export async function toggleCheck(id: string, index: number, user: Actor) {
  const a = await db.assembly.findUnique({ where: { id }, select: { checklist: true } });
  if (!a) throw new AssemblyError("Montage nicht gefunden.");
  const list = readChecklist(a.checklist);
  if (!list[index]) throw new AssemblyError("Checklisten-Punkt nicht gefunden.");
  list[index] = { ...list[index], done: !list[index].done, by: list[index].done ? null : user.name, at: list[index].done ? null : new Date().toISOString() };
  await db.assembly.update({ where: { id }, data: { checklist: list } });
  return list[index];
}

export async function addDefect(id: string, text: string, user: Actor) {
  const a = await db.assembly.findUnique({ where: { id }, select: { defects: true } });
  if (!a) throw new AssemblyError("Montage nicht gefunden.");
  await db.assembly.update({ where: { id }, data: { defects: [...readDefects(a.defects), { text, fixed: false, by: user.name, at: new Date().toISOString() }] } });
}

export function assemblyLine(a: { id: string; number: string; title: string; status: string; startAt: Date; endAt: Date | null; address: string | null; vehicle: string | null; project?: { name: string } | null; crew?: { user: { name: string } }[]; leader?: { name: string } | null }) {
  return `- ${a.number} · ${formatDateTime(a.startAt)}${a.endAt ? `–${formatDate(a.endAt) === formatDate(a.startAt) ? formatDateTime(a.endAt).slice(-5) : formatDate(a.endAt)}` : ""} · ${a.title}${a.project ? ` (${a.project.name})` : ""} · ${ASM_STATUS_LABEL[a.status as AsmStatus] ?? a.status}${a.leader ? ` · Leitung ${a.leader.name}` : ""}${a.crew?.length ? ` · Team ${a.crew.map((c) => c.user.name).join(", ")}` : ""}${a.vehicle ? ` · ${a.vehicle}` : ""}${a.address ? ` · ${a.address}` : ""} · id ${a.id}`;
}
