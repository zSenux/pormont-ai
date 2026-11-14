import "server-only";
import { db } from "@/lib/db";
import { berlinParts, formatDate } from "@/lib/berlin";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { storeFile } from "@/lib/files";
import { sendPush } from "@/lib/push";
import { setPhase } from "@/lib/phases";
import { DRAWING_KIND_LABEL, DRAWING_STATUS_LABEL, indexLetter, type DrawingKind, type DrawingStatus } from "@/lib/drawings-shared";

// Zeichnungen/CAD mit Index-Versionen und Freigabe. Die Werkstatt arbeitet immer mit dem zuletzt
// freigegebenen Index (releasedVersion), auch wenn schon ein neuer Index in Bearbeitung ist.
// Automatik: erste Zeichnung → Phase Konstruktion läuft; alle gültigen Zeichnungen freigegeben → Konstruktion erledigt.

export class DrawingError extends Error {}
type Actor = { id: string; name: string };
type Upload = { name: string; mime: string; data: Buffer };

export async function createDrawing(i: { projectId: string; title: string; kind: DrawingKind; note?: string | null; file: Upload }, user: Actor) {
  const p = await db.project.findUnique({ where: { id: i.projectId }, select: { id: true } });
  if (!p) throw new DrawingError("Projekt nicht gefunden.");
  const f = await storeFile({ ...i.file, kind: "zeichnung", projectId: p.id, uploadedBy: user.name });
  const year = berlinParts().y;
  const d = await db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `ZEICHNUNG-${year}`);
    return tx.drawing.create({
      data: {
        number: `ZG-${year}-${String(n).padStart(4, "0")}`,
        projectId: p.id,
        title: i.title,
        kind: i.kind,
        note: i.note ?? null,
        createdBy: user.name,
        versions: { create: { version: 1, fileId: f.id, note: i.note ?? "Erstausgabe", uploadedBy: user.name } },
      },
    });
  });
  const ph = await db.projectPhase.findFirst({ where: { projectId: p.id, key: "KONSTRUKTION" }, select: { status: true } });
  if (!ph || ph.status === "OFFEN") await setPhase({ projectId: p.id, key: "KONSTRUKTION", status: "LAEUFT", userName: `${user.name} (Automatik)` }).catch(() => {});
  return d;
}

/** Neuer Index (B, C …): Status geht zurück auf „In Bearbeitung“, der alte freigegebene Index bleibt für die Werkstatt gültig */
export async function addVersion(drawingId: string, i: { note?: string | null; file: Upload }, user: Actor) {
  const d = await db.drawing.findUnique({ where: { id: drawingId }, select: { id: true, projectId: true } });
  if (!d) throw new DrawingError("Zeichnung nicht gefunden.");
  const f = await storeFile({ ...i.file, kind: "zeichnung", projectId: d.projectId, uploadedBy: user.name });
  return db.$transaction(async (tx) => {
    const cur = await tx.drawing.update({ where: { id: d.id }, data: { currentVersion: { increment: 1 }, status: "ENTWURF" } });
    await tx.drawingVersion.create({ data: { drawingId: d.id, version: cur.currentVersion, fileId: f.id, note: i.note ?? null, uploadedBy: user.name } });
    return cur;
  });
}

export async function setDrawingStatus(id: string, status: DrawingStatus, user: Actor) {
  const d = await db.drawing.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, leaderId: true } } } });
  if (!d) throw new DrawingError("Zeichnung nicht gefunden.");
  if (status === "FREIGEGEBEN") {
    // atomar: nur den Index freigeben, der gerade aktuell ist
    const r = await db.drawing.updateMany({ where: { id, currentVersion: d.currentVersion }, data: { status, releasedVersion: d.currentVersion, releasedAt: new Date(), releasedBy: user.name } });
    if (!r.count) throw new DrawingError("Inzwischen gibt es einen neueren Index – bitte neu laden.");
    await db.projectNote.create({ data: { projectId: d.projectId, text: `Zeichnung ${d.number} „${d.title}“ Index ${indexLetter(d.currentVersion)} freigegeben.`, authorName: user.name } });
    const open = await db.drawing.count({ where: { projectId: d.projectId, status: { in: ["ENTWURF", "PRUEFUNG"] } } });
    if (open === 0) await setPhase({ projectId: d.projectId, key: "KONSTRUKTION", status: "ERLEDIGT", userName: `${user.name} (Automatik)` }).catch(() => {});
  } else {
    await db.drawing.update({ where: { id }, data: { status } });
    if (status === "PRUEFUNG") await sendPush({ title: "📐 Zeichnung zur Prüfung", body: `${d.project.name}: ${d.number} „${d.title}“ Index ${indexLetter(d.currentVersion)}`, url: `/zeichnungen/${d.id}`, tag: `zeichnung-${d.id}`, ...(d.project.leaderId ? { userId: d.project.leaderId } : {}) });
  }
}

export function drawingLine(d: { id: string; number: string; title: string; kind: string; status: string; currentVersion: number; releasedVersion: number | null; updatedAt: Date; project?: { name: string } | null }) {
  const rel = d.releasedVersion && d.releasedVersion !== d.currentVersion ? ` (gültig für Werkstatt: Index ${indexLetter(d.releasedVersion)})` : "";
  return `- ${d.number} · ${d.title} · ${DRAWING_KIND_LABEL[d.kind as DrawingKind] ?? d.kind} · Index ${indexLetter(d.currentVersion)} · ${DRAWING_STATUS_LABEL[d.status as DrawingStatus] ?? d.status}${rel}${d.project ? ` · ${d.project.name}` : ""} · geändert ${formatDate(d.updatedAt)} · id ${d.id}`;
}
