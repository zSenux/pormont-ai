import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate } from "@/lib/berlin";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { setPhase } from "@/lib/phases";
import { sendPush } from "@/lib/push";
import { PROD_LABEL, type ProdStatus } from "@/lib/production-shared";
import { PRIORITY_LABEL, type Priority } from "@/lib/phases-shared";

// Fertigungsplanung/Werkstattsteuerung: Fertigungsaufträge (FA-<Jahr>-0001) je Projekt mit Status, Maschine,
// Werker, Plan-/Ist-Zeiten, Material, Qualitätskontrolle und Fertigmeldung.
// Automatik: erste Karte in Fertigung → Phase Fertigung läuft; alle Karten fertig → Phase Fertigung erledigt,
// Montage freigegeben (Phase Montage läuft) und Projektleiter per Push benachrichtigt.

export class ProductionError extends Error {}
type Actor = { id: string; name: string };

export async function createJob(input: { projectId: string; title: string; instructions?: string | null; quantity?: string | null; machine?: string | null; assigneeId?: string | null; start?: string | null; end?: string | null; plannedHours?: number | null; priority?: Priority }, user: Actor) {
  const year = berlinParts().y;
  const project = await db.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) throw new ProductionError("Projekt nicht gefunden.");
  return db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `FERTIGUNG-${year}`);
    return tx.productionJob.create({
      data: {
        number: `FA-${year}-${String(n).padStart(4, "0")}`,
        projectId: input.projectId,
        title: input.title,
        instructions: input.instructions ?? null,
        quantity: input.quantity ?? null,
        machine: input.machine ?? null,
        assigneeId: input.assigneeId ?? null,
        plannedStart: input.start ? berlinDateTime(input.start) : null,
        plannedEnd: input.end ? berlinDateTime(input.end) : null,
        plannedHours: input.plannedHours ?? null,
        priority: input.priority ?? "NORMAL",
        createdBy: user.name,
      },
    });
  });
}

/** Status setzen inkl. QK-/Fertigmeldung und Automatik für Projektphasen */
export async function setJobStatus(id: string, status: ProdStatus, user: Actor, extra: { actualHours?: number | null; qcNote?: string | null } = {}) {
  const job = await db.productionJob.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, leaderId: true } } } });
  if (!job) throw new ProductionError("Fertigungsauftrag nicht gefunden.");
  const finished = status === "FERTIG" || status === "MONTAGEBEREIT";
  await db.productionJob.update({
    where: { id },
    data: {
      status,
      ...(status === "MATERIAL_FEHLT" ? { materialOk: false } : {}),
      ...(status === "IN_FERTIGUNG" ? { materialOk: true } : {}),
      ...(extra.actualHours !== undefined ? { actualHours: extra.actualHours } : {}),
      ...(status === "FERTIG" || (status === "MONTAGEBEREIT" && !job.qcAt) ? { qcAt: job.qcAt ?? new Date(), qcBy: job.qcBy ?? user.name, qcNote: extra.qcNote ?? job.qcNote } : {}),
      ...(extra.qcNote !== undefined && status === "QK" ? { qcNote: extra.qcNote } : {}),
      ...(finished ? { doneAt: job.doneAt ?? new Date(), doneBy: job.doneBy ?? user.name } : { doneAt: null, doneBy: null }),
    },
  });
  // Automatik Projektphasen
  if (status === "IN_FERTIGUNG") {
    await setPhase({ projectId: job.projectId, key: "FERTIGUNG", status: "LAEUFT", userName: user.name }).catch(() => {});
  }
  if (finished) {
    const open = await db.productionJob.count({ where: { projectId: job.projectId, status: { notIn: ["FERTIG", "MONTAGEBEREIT"] } } });
    if (open === 0) {
      const phase = await db.projectPhase.findFirst({ where: { projectId: job.projectId, key: "FERTIGUNG" } });
      if (phase && phase.status !== "ERLEDIGT") {
        await setPhase({ projectId: job.projectId, key: "FERTIGUNG", status: "ERLEDIGT", userName: user.name });
        const montage = await db.projectPhase.findFirst({ where: { projectId: job.projectId, key: "MONTAGE" } });
        if (montage?.status === "OFFEN") await setPhase({ projectId: job.projectId, key: "MONTAGE", status: "LAEUFT", userName: `${user.name} (Automatik)` });
        await sendPush({ title: "Fertigung abgeschlossen", body: `${job.project.name}: alle Fertigungsaufträge fertig – Montage kann geplant werden.`, url: `/projekte/${job.projectId}`, tag: `fertig-${job.projectId}`, ...(job.project.leaderId ? { userId: job.project.leaderId } : {}) });
      }
    }
  }
}

/** Auslastung je Mitarbeiter und Maschine (Plan-Stunden offener Karten, deren Zeitraum die Woche schneidet) */
export async function capacity(weekStart: Date) {
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000);
  const jobs = await db.productionJob.findMany({
    where: { status: { notIn: ["FERTIG", "MONTAGEBEREIT"] }, OR: [{ plannedStart: { lt: weekEnd }, plannedEnd: { gte: weekStart } }, { plannedStart: null, plannedEnd: { gte: weekStart, lt: weekEnd } }] },
    select: { plannedHours: true, machine: true, assignee: { select: { name: true } } },
  });
  const by = (key: (j: (typeof jobs)[number]) => string) => [...jobs.reduce((m, j) => m.set(key(j), (m.get(key(j)) ?? 0) + (j.plannedHours ?? 0)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  return { workers: by((j) => j.assignee?.name ?? "nicht zugeteilt"), machines: by((j) => j.machine ?? "ohne Maschine"), jobs: jobs.length };
}

export function jobLine(j: { id: string; number: string; title: string; status: string; priority: string; machine: string | null; plannedEnd: Date | null; plannedHours: number | null; materialOk: boolean; assignee?: { name: string } | null; project?: { name: string } | null }) {
  const late = j.plannedEnd && j.plannedEnd < new Date() && !["FERTIG", "MONTAGEBEREIT"].includes(j.status);
  return `- ${j.number} · ${j.title}${j.project ? ` · ${j.project.name}` : ""} · ${PROD_LABEL[j.status as ProdStatus] ?? j.status}${j.priority !== "NORMAL" ? ` · ${PRIORITY_LABEL[j.priority as Priority]}` : ""}${j.assignee ? ` · ${j.assignee.name}` : ""}${j.machine ? ` · ${j.machine}` : ""}${j.plannedHours ? ` · ${j.plannedHours} Std. geplant` : ""}${j.plannedEnd ? ` · fertig bis ${formatDate(j.plannedEnd)}${late ? " ⚠ überschritten" : ""}` : ""}${j.materialOk ? "" : " · Material nicht bestätigt"} · id ${j.id}`;
}
