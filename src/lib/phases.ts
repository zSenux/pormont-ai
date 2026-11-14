import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { PHASES, PHASE_STATUS_LABEL, PRIORITY_LABEL, type PhaseKey, type PhaseStatus } from "@/lib/phases-shared";

// Projektmanagement: 12 feste Phasen je Projekt (Kundenanfrage … Projektabschluss), Meilensteine, Team, Projektaufgaben.
// Interne Daten – Jarvis darf sie direkt ändern (sichtbar mit Name, jederzeit änderbar).

export { PHASES, PHASE_STATUS_LABEL, PRIORITY_LABEL, type PhaseKey, type PhaseStatus };

export class PhaseError extends Error {}

/** Legt fehlende Phasen eines Projekts an (idempotent). Neue Projekte starten in „Kundenanfrage“. */
export async function ensurePhases(projectId: string) {
  const have = await db.projectPhase.findMany({ where: { projectId }, select: { key: true } });
  if (have.length >= PHASES.length) return;
  const known = new Set(have.map((h) => h.key));
  await db.projectPhase.createMany({
    data: PHASES.filter((p) => !known.has(p.key)).map((p) => ({ projectId, key: p.key, sort: p.sort })),
    skipDuplicates: true,
  });
}

export async function projectPhases(projectId: string) {
  await ensurePhases(projectId);
  return db.projectPhase.findMany({ where: { projectId }, orderBy: { sort: "asc" } });
}

type PhaseLike = { key: string; status: string; sort: number };

/** Fortschritt in Prozent: erledigte Phasen / alle nicht entfallenen Phasen; laufende zählen halb */
export function progressOf(phases: PhaseLike[]) {
  const relevant = phases.filter((p) => p.status !== "ENTFAELLT");
  if (!relevant.length) return 0;
  const score = relevant.reduce((s, p) => s + (p.status === "ERLEDIGT" ? 1 : p.status === "LAEUFT" ? 0.5 : 0), 0);
  return Math.round((score / relevant.length) * 100);
}

/** Aktuelle Phase: erste laufende, sonst erste offene nach der letzten erledigten */
export function currentPhase(phases: PhaseLike[]) {
  const sorted = [...phases].sort((a, b) => a.sort - b.sort);
  const running = sorted.find((p) => p.status === "LAEUFT");
  if (running) return running;
  return sorted.find((p) => p.status === "OFFEN") ?? null;
}

export const phaseTitle = (key: string) => PHASES.find((p) => p.key === key)?.title ?? key;

/**
 * Status einer Phase setzen. „LAEUFT“ setzt automatisch alle früheren offenen Phasen auf erledigt nicht –
 * das bleibt bewusst manuell. Ist die letzte Phase erledigt, wird das Projekt auf FERTIG gesetzt.
 */
export async function setPhase(input: { projectId: string; key: PhaseKey; status?: PhaseStatus; start?: string | null; ende?: string | null; note?: string | null; userName: string }) {
  await ensurePhases(input.projectId);
  const data: Record<string, unknown> = {};
  if (input.status) {
    data.status = input.status;
    data.doneAt = input.status === "ERLEDIGT" ? new Date() : null;
    data.doneByName = input.status === "ERLEDIGT" ? input.userName : null;
  }
  if (input.start !== undefined) data.startDate = input.start ? berlinDateTime(input.start) : null;
  if (input.ende !== undefined) data.endDate = input.ende ? berlinDateTime(input.ende) : null;
  if (input.note !== undefined) data.note = input.note || null;
  const r = await db.projectPhase.updateMany({ where: { projectId: input.projectId, key: input.key }, data });
  if (!r.count) throw new PhaseError("Phase nicht gefunden.");
  // Projektstatus mitziehen: Phase läuft → Projekt läuft; Abschluss erledigt → Projekt fertig
  if (input.status === "LAEUFT") await db.project.updateMany({ where: { id: input.projectId, status: "PLANUNG" }, data: { status: "LAEUFT" } });
  if (input.status === "ERLEDIGT" && input.key === "ABSCHLUSS") {
    const r = await db.project.updateMany({ where: { id: input.projectId, status: { not: "FERTIG" } }, data: { status: "FERTIG" } });
    // Automatik: Projekt abgeschlossen → Nachkalkulation
    if (r.count) await (await import("@/lib/automation")).onProjectClosed(input.projectId, input.userName);
  }
}

/** Kurztext für Jarvis: Phasen, Meilensteine, Team, offene Projektaufgaben */
export async function planText(projectId: string) {
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: {
      leader: { select: { name: true } },
      members: { include: { user: { select: { name: true } } } },
      milestones: { orderBy: [{ doneAt: "asc" }, { dueDate: "asc" }] },
      tasks: { where: { doneAt: null }, orderBy: { dueAt: "asc" }, include: { assignee: { select: { name: true } } } },
    },
  });
  if (!p) return "Projekt nicht gefunden.";
  const phases = await projectPhases(projectId);
  const cur = currentPhase(phases);
  const lines = [
    `Projekt „${p.name}“ · Fortschritt ${progressOf(phases)} %${cur ? ` · aktuelle Phase: ${phaseTitle(cur.key)}` : " · alle Phasen erledigt"}`,
    `Projektleiter: ${p.leader?.name ?? "nicht festgelegt"} · Team: ${p.members.length ? p.members.map((m) => `${m.user.name}${m.role ? ` (${m.role})` : ""}`).join(", ") : "niemand zugeordnet"}`,
    "Phasen:",
    ...phases.map((x) => `- ${x.sort}. ${phaseTitle(x.key)} [${x.key}]: ${PHASE_STATUS_LABEL[x.status as PhaseStatus] ?? x.status}${x.startDate || x.endDate ? ` · geplant ${x.startDate ? formatDate(x.startDate) : "?"}–${x.endDate ? formatDate(x.endDate) : "?"}` : ""}${x.doneAt ? ` · erledigt ${formatDate(x.doneAt)}${x.doneByName ? ` (${x.doneByName})` : ""}` : ""}${x.note ? ` · ${x.note}` : ""}`),
    `Meilensteine: ${p.milestones.length ? "" : "keine"}`,
    ...p.milestones.map((m) => `- ${m.doneAt ? "✓" : "○"} ${m.title}${m.dueDate ? ` · ${formatDate(m.dueDate)}` : ""}${!m.doneAt && m.dueDate && m.dueDate < new Date() ? " ⚠ überfällig" : ""} · id ${m.id}`),
    `Offene Projektaufgaben: ${p.tasks.length ? "" : "keine"}`,
    ...p.tasks.map((t) => `- ${t.title}${t.assignee ? ` · ${t.assignee.name}` : ""}${t.priority !== "NORMAL" ? ` · ${PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL] ?? t.priority}` : ""}${t.dueAt ? ` · fällig ${formatDate(t.dueAt)}${t.dueAt < new Date() ? " ⚠ überfällig" : ""}` : ""} · id ${t.id}`),
    `[Projekt öffnen](/projekte/${p.id})`,
  ];
  return lines.join("\n");
}

/** Mitarbeiter per Name finden (für Jarvis: „Projektleiter ist Josip“) */
export async function findUserByName(name: string) {
  const q = name.trim();
  if (!q) return null;
  const users = await db.user.findMany({ where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }, select: { id: true, name: true }, take: 3 });
  if (users.length === 1) return users[0];
  if (users.length > 1) throw new PhaseError(`Mehrere Mitarbeiter passen zu „${q}“: ${users.map((u) => u.name).join(", ")}. Bitte genauer angeben.`);
  throw new PhaseError(`Kein Mitarbeiter „${q}“ gefunden.`);
}
