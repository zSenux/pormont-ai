import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { findUserByName, PhaseError, phaseTitle, planText, setPhase } from "@/lib/phases";
import { PHASE_KEYS, PHASE_STATUSES, PRIORITIES } from "@/lib/phases-shared";
import type { ToolCtx } from "./tools";

// EPS-Module für Jarvis: Projektplanung (Phasen, Meilensteine, Projektleiter/Team, Projektaufgaben).
// Interne Daten – Jarvis ändert sie direkt (sichtbar mit Name, jederzeit änderbar).

const str = (description: string) => ({ type: "string" as const, description });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");

export const EPS_TOOLS: Anthropic.Tool[] = [
  {
    name: "projekt_planung",
    description:
      "Projektmanagement eines Projekts: stand (Phasen mit Fortschritt, Meilensteine, Projektleiter, Team, offene Projektaufgaben), phase (Status/Termin einer der 12 Phasen setzen), meilenstein (anlegen/erreicht), leiter (Projektleiter setzen), team (Mitarbeiter ins Team), aufgabe (Projektaufgabe mit Verantwortlichem, Priorität, Fälligkeit).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["stand", "phase", "meilenstein", "meilenstein_erreicht", "leiter", "team", "aufgabe"] },
        projekt_id: str("Projekt-ID aus projekte"),
        phase: { type: "string", enum: PHASE_KEYS, description: "phase: ANFRAGE, ANGEBOT, AUFTRAG, PLANUNG (technische Planung), KONSTRUKTION, BESCHAFFUNG, FERTIGUNG, OBERFLAECHE, MONTAGE, ABNAHME, RECHNUNG, ABSCHLUSS" },
        status: { type: "string", enum: PHASE_STATUSES, description: "phase: OFFEN, LAEUFT, ERLEDIGT, ENTFAELLT" },
        start: str("phase: geplanter Beginn JJJJ-MM-TT"),
        ende: str("phase: geplantes Ende JJJJ-MM-TT"),
        titel: str("meilenstein/aufgabe: Titel"),
        datum: str("meilenstein/aufgabe: Datum JJJJ-MM-TT"),
        id: str("meilenstein_erreicht: Meilenstein-ID aus stand"),
        mitarbeiter: str("leiter/team/aufgabe: Name des Mitarbeiters"),
        rolle: str("team: Aufgabe im Projekt, z. B. „Montage“"),
        prioritaet: { type: "string", enum: PRIORITIES },
        notiz: str("phase: Notiz (optional)"),
      },
      required: ["aktion", "projekt_id"],
    },
  },
];

export const EPS_TOOL_NAMES = new Set(EPS_TOOLS.map((t) => t.name));

export async function runEpsTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    const q = z
      .object({
        aktion: z.enum(["stand", "phase", "meilenstein", "meilenstein_erreicht", "leiter", "team", "aufgabe"]),
        projekt_id: z.cuid(),
        phase: z.enum(PHASE_KEYS).optional(),
        status: z.enum(PHASE_STATUSES).optional(),
        start: ymd.optional(),
        ende: ymd.optional(),
        titel: z.string().trim().min(2).max(300).optional(),
        datum: ymd.optional(),
        id: z.cuid().optional(),
        mitarbeiter: z.string().trim().max(80).optional(),
        rolle: z.string().trim().max(60).optional(),
        prioritaet: z.enum(PRIORITIES).optional(),
        notiz: z.string().trim().max(1000).optional(),
      })
      .parse(i);
    const project = await db.project.findUnique({ where: { id: q.projekt_id }, select: { id: true, name: true } });
    if (!project) return "Projekt nicht gefunden – ID mit projekte (liste) holen.";
    const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
    const link = `[Projekt öffnen](/projekte/${project.id})`;
    switch (q.aktion) {
      case "stand":
        return planText(project.id);
      case "phase": {
        if (!q.phase) return "Welche Phase? (phase angeben)";
        if (!q.status && q.start === undefined && q.ende === undefined && q.notiz === undefined) return "Was soll an der Phase geändert werden? (status, start, ende oder notiz)";
        await setPhase({ projectId: project.id, key: q.phase, status: q.status, start: q.start, ende: q.ende, note: q.notiz, userName: `${me.name} (über Jarvis)` });
        return `Phase „${phaseTitle(q.phase)}“ in „${project.name}“ aktualisiert${q.status ? ` (${q.status.toLowerCase()})` : ""}. ${link}`;
      }
      case "meilenstein": {
        if (!q.titel) return "Titel des Meilensteins fehlt.";
        const m = await db.projectMilestone.create({ data: { projectId: project.id, title: q.titel, dueDate: q.datum ? berlinDateTime(q.datum) : null } });
        return `Meilenstein „${m.title}“${m.dueDate ? ` zum ${formatDate(m.dueDate)}` : ""} angelegt. ${link}`;
      }
      case "meilenstein_erreicht": {
        if (!q.id) return "Meilenstein-ID fehlt (aus stand).";
        const r = await db.projectMilestone.updateMany({ where: { id: q.id, projectId: project.id, doneAt: null }, data: { doneAt: new Date() } });
        return r.count ? `Meilenstein als erreicht markiert. ${link}` : "Meilenstein nicht gefunden oder schon erreicht.";
      }
      case "leiter": {
        if (!q.mitarbeiter) return "Name des Projektleiters fehlt.";
        const u = await findUserByName(q.mitarbeiter);
        await db.project.update({ where: { id: project.id }, data: { leaderId: u!.id } });
        return `${u!.name} ist jetzt Projektleiter von „${project.name}“. ${link}`;
      }
      case "team": {
        if (!q.mitarbeiter) return "Name des Mitarbeiters fehlt.";
        const u = await findUserByName(q.mitarbeiter);
        await db.projectMember.upsert({ where: { projectId_userId: { projectId: project.id, userId: u!.id } }, create: { projectId: project.id, userId: u!.id, role: q.rolle ?? null }, update: { role: q.rolle ?? null } });
        return `${u!.name} ist im Team von „${project.name}“${q.rolle ? ` (${q.rolle})` : ""}. ${link}`;
      }
      case "aufgabe": {
        if (!q.titel) return "Titel der Aufgabe fehlt.";
        const u = q.mitarbeiter ? await findUserByName(q.mitarbeiter) : null;
        const t = await db.task.create({ data: { title: q.titel, dueAt: q.datum ? berlinDateTime(q.datum) : null, projectId: project.id, assigneeId: u?.id ?? null, priority: q.prioritaet ?? "NORMAL", createdById: ctx.userId } });
        return `Aufgabe „${t.title}“ im Projekt „${project.name}“ angelegt${u ? ` für ${u.name}` : ""}${t.dueAt ? `, fällig ${formatDate(t.dueAt)}` : ""}. ${link}`;
      }
    }
  } catch (e) {
    if (e instanceof z.ZodError) return `Eingabe ungültig: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof PhaseError) return e.message;
    throw e;
  }
  return "Unbekannte Aktion.";
}
