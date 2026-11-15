import "server-only";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { DEFECT_OPEN, DEFECT_STATUS_LABEL, SEVERITY_DAYS, SEVERITY_LABEL, SOURCE_LABEL, warrantyYears, type DefectSource, type DefectStatus, type Severity } from "@/lib/maengel-shared";

// Mängelmanagement: Mangel erfassen (mit Foto), zuweisen, beheben, prüfen/abhaken.
// Gewährleistung je Projekt: bis Project.warrantyUntil oder Abnahme (Unterschrift Montage) + GEWAEHRLEISTUNG_JAHRE.
// Ein Mangel nach der Abnahme innerhalb der Frist ist automatisch ein Gewährleistungsfall.

export class DefectError extends Error {}
type Actor = { id: string; name: string; role?: string };

const ymd = (d: Date) => berlinParts(d).ymd;

/** Abnahme (letzte Unterschrift einer Montage) und Ende der Gewährleistung eines Projekts */
export async function warrantyOf(projectId: string) {
  const [p, acc] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { warrantyUntil: true } }),
    db.assembly.findFirst({ where: { projectId, signedAt: { not: null } }, orderBy: { signedAt: "desc" }, select: { signedAt: true } }),
  ]);
  const acceptedAt = acc?.signedAt ?? null;
  let until = p?.warrantyUntil ?? null;
  if (!until && acceptedAt) {
    const d = new Date(acceptedAt);
    d.setUTCFullYear(d.getUTCFullYear() + warrantyYears());
    until = d;
  }
  return { acceptedAt, until, manual: Boolean(p?.warrantyUntil), active: Boolean(until && until.getTime() >= Date.now()) };
}

/** Alle Projekte mit Gewährleistung (abgenommen oder Frist von Hand), sortiert nach Ablauf */
export async function warrantyList() {
  const [signed, manual] = await Promise.all([
    db.assembly.findMany({ where: { signedAt: { not: null } }, select: { projectId: true } }),
    db.project.findMany({ where: { warrantyUntil: { not: null } }, select: { id: true } }),
  ]);
  const ids = [...new Set([...signed.map((s) => s.projectId), ...manual.map((m) => m.id)])];
  const projects = await db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, customer: true, leaderId: true, _count: { select: { defects: { where: { warranty: true } } } } } });
  const rows = await Promise.all(projects.map(async (p) => ({ ...p, ...(await warrantyOf(p.id)) })));
  return rows.filter((r) => r.until).sort((a, b) => a.until!.getTime() - b.until!.getTime());
}

export async function createDefect(i: { projectId: string; title: string; description?: string | null; location?: string | null; severity?: Severity; source?: DefectSource; assigneeId?: string | null; dueDate?: string | null; costCents?: number | null }, actor: Actor) {
  const project = await db.project.findUnique({ where: { id: i.projectId }, select: { id: true, name: true, leaderId: true } });
  if (!project) throw new DefectError("Projekt nicht gefunden.");
  if (i.assigneeId && !(await db.user.findUnique({ where: { id: i.assigneeId }, select: { id: true } }))) throw new DefectError("Mitarbeiter nicht gefunden.");
  const severity = i.severity ?? "MITTEL";
  const w = await warrantyOf(project.id);
  // Nach der Abnahme gemeldet und innerhalb der Frist → Gewährleistung
  const warranty = i.source === "GEWAEHRLEISTUNG" || Boolean(w.acceptedAt && w.active && i.source !== "ABNAHME" && i.source !== "INTERN");
  const source: DefectSource = i.source ?? (warranty ? "GEWAEHRLEISTUNG" : "INTERN");
  const due = i.dueDate ?? addDaysYmd(todayYmd(), SEVERITY_DAYS[severity]);
  const year = Number(todayYmd().slice(0, 4));
  const d = await db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `MANGEL-${year}`);
    return tx.defect.create({
      data: { number: `MG-${year}-${String(n).padStart(4, "0")}`, projectId: project.id, title: i.title, description: i.description || null, location: i.location || null, severity, source, warranty, assigneeId: i.assigneeId || null, dueDate: berlinDateTime(due), reportedBy: actor.name, costCents: i.costCents ?? null },
    });
  });
  const to = d.assigneeId ?? project.leaderId;
  if (to && to !== actor.id) await sendPush({ title: `🔧 Mangel ${d.number}${severity === "SCHWER" ? " (schwer)" : ""}`, body: `${project.name}: ${d.title} – bis ${formatDate(d.dueDate)}`, url: `/maengel/${d.id}`, tag: `mangel-${d.id}`, userId: to });
  return d;
}

/** Status setzen. BEHOBEN = Monteur meldet Beseitigung; ERLEDIGT = geprüft/abgehakt (Projektleitung) */
export async function setDefectStatus(id: string, status: DefectStatus, note: string | null, actor: Actor) {
  const d = await db.defect.findUnique({ where: { id }, include: { project: { select: { name: true, leaderId: true } } } });
  if (!d) throw new DefectError("Mangel nicht gefunden.");
  if (d.status === status) return d;
  const now = new Date();
  const data: Record<string, unknown> = { status };
  if (status === "BEHOBEN") Object.assign(data, { fixedAt: now, fixedBy: actor.name, ...(note ? { fixNote: note } : {}) });
  if (status === "ERLEDIGT" || status === "ABGELEHNT") Object.assign(data, { closedAt: now, closedBy: actor.name, ...(note ? { fixNote: d.fixNote ? `${d.fixNote}\n${note}` : note } : {}), ...(d.fixedAt ? {} : status === "ERLEDIGT" ? { fixedAt: now, fixedBy: actor.name } : {}) });
  if (status === "OFFEN" || status === "IN_ARBEIT") Object.assign(data, { closedAt: null, closedBy: null, ...(status === "OFFEN" ? { fixedAt: null, fixedBy: null } : {}) });
  // Atomar gegen den alten Status – zwei Klicks gleichzeitig ändern nur einmal
  const r = await db.defect.updateMany({ where: { id, status: d.status }, data });
  if (!r.count) throw new DefectError("Der Mangel wurde gerade geändert – bitte neu laden.");
  if (status === "BEHOBEN" && d.project.leaderId && d.project.leaderId !== actor.id) await sendPush({ title: `✅ Mangel ${d.number} behoben`, body: `${d.project.name}: ${d.title} – bitte prüfen und abhaken`, url: `/maengel/${d.id}`, tag: `mangel-${d.id}`, userId: d.project.leaderId });
  return db.defect.findUniqueOrThrow({ where: { id } });
}

export async function assignDefect(id: string, assigneeId: string | null, dueDate: string | null | undefined, actor: Actor) {
  const d = await db.defect.update({ where: { id }, data: { assigneeId, ...(dueDate !== undefined ? { dueDate: dueDate ? berlinDateTime(dueDate) : null } : {}) }, include: { project: { select: { name: true } } } });
  if (assigneeId && assigneeId !== actor.id) await sendPush({ title: `🔧 Mangel ${d.number} an dich`, body: `${d.project.name}: ${d.title}${d.dueDate ? ` – bis ${formatDate(d.dueDate)}` : ""}`, url: `/maengel/${d.id}`, tag: `mangel-${d.id}`, userId: assigneeId });
  return d;
}

export function defectLine(d: { id: string; number: string; title: string; status: string; severity: string; warranty: boolean; location?: string | null; dueDate: Date | null; assignee?: { name: string } | null; project?: { name: string } | null }) {
  const late = d.dueDate && DEFECT_OPEN.includes(d.status as DefectStatus) && ymd(d.dueDate) < todayYmd();
  return `- ${d.number} „${d.title}“${d.project ? ` (${d.project.name})` : ""}${d.location ? ` · ${d.location}` : ""} · ${DEFECT_STATUS_LABEL[d.status as DefectStatus] ?? d.status} · ${SEVERITY_LABEL[d.severity as Severity] ?? d.severity}${d.warranty ? " · Gewährleistung" : ""}${d.assignee ? ` · ${d.assignee.name}` : " · niemand zugewiesen"}${d.dueDate ? ` · bis ${formatDate(d.dueDate)}${late ? " ⚠️ überfällig" : ""}` : ""} · id ${d.id}`;
}

export const sourceLabel = (s: string) => SOURCE_LABEL[s as DefectSource] ?? s;

/** Gewährleistung läuft in ≤ 90 Tagen ab → einmal Push an Projektleitung (Begehung vor Ablauf) */
export async function warrantyReminders(once: (key: string) => Promise<boolean>) {
  const soon = Date.now() + 90 * 86400_000;
  for (const w of await warrantyList()) {
    if (!w.until || w.until.getTime() < Date.now() || w.until.getTime() > soon) continue;
    if (!(await once(`gewaehr:${w.id}:${ymd(w.until)}`))) continue;
    await sendPush({ title: "🛡️ Gewährleistung läuft ab", body: `${w.name}: endet am ${formatDate(w.until)} – Begehung machen und Mängel vorher melden lassen`, url: `/maengel?ansicht=gewaehrleistung`, tag: `gewaehr-${w.id}`, ...(w.leaderId ? { userId: w.leaderId } : {}) });
  }
}
