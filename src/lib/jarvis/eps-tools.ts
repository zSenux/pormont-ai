import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { findUserByName, PhaseError, phaseTitle, planText, setPhase } from "@/lib/phases";
import { PHASE_KEYS, PHASE_STATUSES, PRIORITIES } from "@/lib/phases-shared";
import { createOrder, createOrderFromQuote, OrderError, orderText } from "@/lib/orders";
import { ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatus } from "@/lib/orders-shared";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { addNote, CrmError, customerFileText, dueFollowUps, newInquiry, NOTE_KINDS } from "@/lib/crm";
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
  {
    name: "auftraege",
    description:
      "Aufträge (mit Auftragsnummer AU-JJJJ-NNNN und Projektakte): liste (aktive, Suche nach Nummer/Kunde/Titel), details, aus_angebot (Auftrag aus einem angenommenen Angebot anlegen – passiert beim Annehmen auch automatisch), anlegen (ohne Angebot), status, aendern (Termine, Wert, Materialbedarf, Fertigungsinfos, Notiz).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "details", "aus_angebot", "anlegen", "status", "aendern"] },
        id: str("details/status/aendern: Auftrags-ID oder Auftragsnummer"),
        suche: str("liste: Nummer, Kunde oder Titel"),
        alle: { type: "boolean", description: "liste: auch abgeschlossene/stornierte" },
        angebot: str("aus_angebot: Angebots-ID oder Angebotsnummer (AN-…)"),
        titel: str("anlegen/aendern: Bezeichnung"),
        kunde_id: str("anlegen: Kunden-ID aus der Buchhaltung (optional)"),
        wert_netto: { type: "number", description: "anlegen/aendern: Auftragswert netto in Euro" },
        beginn: str("anlegen/aendern: JJJJ-MM-TT"),
        fertig_bis: str("anlegen/aendern: Fertigstellungstermin JJJJ-MM-TT"),
        status: { type: "string", enum: ORDER_STATUSES },
        material: str("aendern: Materialbedarf (ersetzt den bisherigen Text)"),
        fertigung: str("aendern: Fertigungsinformationen (ersetzt den bisherigen Text)"),
        notiz: str("aendern: interne Notiz (ersetzt den bisherigen Text)"),
      },
      required: ["aktion"],
    },
  },
  {
    name: "kundenakte",
    description:
      "Kundenakte (CRM): akte (Kontakt, Aufträge, Anfragen, Belege, Kontakthistorie, Wiedervorlagen eines Kunden), notiz (Anruf/Mail/Besuch/Notiz festhalten, optional mit Wiedervorlage), wiedervorlagen (fällige bis Datum, Standard heute + 7 Tage), erledigt (Wiedervorlage abhaken), anfrage (neue Kundenanfrage → Projekt in Phase Kundenanfrage).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["akte", "notiz", "wiedervorlagen", "erledigt", "anfrage"] },
        kunde: str("akte/notiz/anfrage: Kunden-ID (aus kunden_suchen) oder Name"),
        art: { type: "string", enum: NOTE_KINDS, description: "notiz: NOTIZ, ANRUF, MAIL, TERMIN, BESUCH" },
        text: str("notiz: Inhalt; anfrage: Beschreibung"),
        wiedervorlage: str("notiz: Wiedervorlage am JJJJ-MM-TT (optional)"),
        mitarbeiter: str("notiz: zuständig für die Wiedervorlage (Name, optional)"),
        bis: str("wiedervorlagen: bis JJJJ-MM-TT"),
        id: str("erledigt: Wiedervorlagen-ID"),
        titel: str("anfrage: kurze Bezeichnung, z. B. „Geländer Balkon 2. OG“"),
      },
      required: ["aktion"],
    },
  },
];

export const EPS_TOOL_NAMES = new Set(EPS_TOOLS.map((t) => t.name));

export async function runEpsTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  if (name === "auftraege") return runOrders(i, ctx);
  if (name === "kundenakte") return runCrm(i, ctx);
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

async function findOrder(ref: string) {
  const r = ref.trim();
  return db.order.findFirst({ where: { OR: [{ id: r }, { number: { equals: r, mode: "insensitive" } }] } });
}

async function runOrders(i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    const q = z
      .object({
        aktion: z.enum(["liste", "details", "aus_angebot", "anlegen", "status", "aendern"]),
        id: z.string().trim().max(40).optional(),
        suche: z.string().trim().max(80).optional(),
        alle: z.boolean().optional(),
        angebot: z.string().trim().max(40).optional(),
        titel: z.string().trim().min(2).max(200).optional(),
        kunde_id: z.cuid().optional(),
        wert_netto: z.number().min(0).max(100_000_000).optional(),
        beginn: ymd.optional(),
        fertig_bis: ymd.optional(),
        status: z.enum(ORDER_STATUSES).optional(),
        material: z.string().trim().max(8000).optional(),
        fertigung: z.string().trim().max(8000).optional(),
        notiz: z.string().trim().max(8000).optional(),
      })
      .parse(i);
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true } });
    const actor = { id: user.id, name: `${user.name} (über Jarvis)` };
    switch (q.aktion) {
      case "liste": {
        const s = q.suche;
        const list = await db.order.findMany({
          where: {
            ...(q.alle ? {} : { status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } }),
            ...(s ? { OR: [{ number: { contains: s, mode: "insensitive" as const } }, { title: { contains: s, mode: "insensitive" as const } }, { customer: { name: { contains: s, mode: "insensitive" as const } } }] } : {}),
          },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          take: 40,
          include: { customer: { select: { name: true } } },
        });
        if (!list.length) return "Keine passenden Aufträge. [Aufträge](/auftraege)";
        const sum = list.reduce((a, o) => a + o.valueCents, 0);
        return `${list.length} Aufträge, Volumen netto ${fmtEuroCents(sum)}:\n${list.map((o) => `- ${o.number} · ${o.title} · ${o.customer?.name ?? "–"} · ${fmtEuroCents(o.valueCents)} · ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}${o.dueDate ? ` · fertig bis ${formatDate(o.dueDate)}${o.dueDate < new Date() ? " ⚠" : ""}` : ""} · id ${o.id}`).join("\n")}`;
      }
      case "details": {
        const o = q.id ? await findOrder(q.id) : null;
        return o ? orderText(o.id) : "Auftrag nicht gefunden (ID oder Nummer AU-… angeben).";
      }
      case "aus_angebot": {
        if (!q.angebot) return "Welches Angebot? (ID oder Nummer)";
        const doc = await db.salesDoc.findFirst({ where: { kind: "ANGEBOT", OR: [{ id: q.angebot }, { number: { equals: q.angebot, mode: "insensitive" } }] }, select: { id: true } });
        if (!doc) return "Angebot nicht gefunden.";
        const r = await createOrderFromQuote(doc.id, actor);
        return `${r.created ? "Auftrag angelegt" : "Zu diesem Angebot gibt es schon einen Auftrag"}: ${r.order.number}. Das Angebot steht auf „angenommen“.\n${await orderText(r.order.id)}`;
      }
      case "anlegen": {
        if (!q.titel) return "Bezeichnung (titel) fehlt.";
        const o = await createOrder({ title: q.titel, customerId: q.kunde_id, valueCents: q.wert_netto !== undefined ? Math.round(q.wert_netto * 100) : 0, start: q.beginn, due: q.fertig_bis }, actor);
        return `Auftrag ${o.number} angelegt (mit Projektakte).\n${await orderText(o.id)}`;
      }
      case "status": {
        const o = q.id ? await findOrder(q.id) : null;
        if (!o || !q.status) return "Auftrag (id) und status angeben.";
        await db.order.update({ where: { id: o.id }, data: { status: q.status } });
        const ps = q.status === "ABGESCHLOSSEN" ? "FERTIG" : q.status === "PAUSIERT" || q.status === "STORNIERT" ? "PAUSIERT" : "LAEUFT";
        await db.project.update({ where: { id: o.projectId }, data: { status: ps } });
        return `Auftrag ${o.number} steht jetzt auf „${ORDER_STATUS_LABEL[q.status]}“. [Auftrag öffnen](/auftraege/${o.id})`;
      }
      case "aendern": {
        const o = q.id ? await findOrder(q.id) : null;
        if (!o) return "Auftrag nicht gefunden.";
        const u = await db.order.update({
          where: { id: o.id },
          data: {
            ...(q.titel ? { title: q.titel } : {}),
            ...(q.wert_netto !== undefined ? { valueCents: Math.round(q.wert_netto * 100) } : {}),
            ...(q.beginn ? { startDate: berlinDateTime(q.beginn) } : {}),
            ...(q.fertig_bis ? { dueDate: berlinDateTime(q.fertig_bis) } : {}),
            ...(q.material !== undefined ? { material: q.material || null } : {}),
            ...(q.fertigung !== undefined ? { production: q.fertigung || null } : {}),
            ...(q.notiz !== undefined ? { notes: q.notiz || null } : {}),
          },
        });
        if (q.fertig_bis || q.beginn) await db.project.update({ where: { id: u.projectId }, data: { ...(q.fertig_bis ? { endDate: u.dueDate } : {}), ...(q.beginn ? { startDate: u.startDate } : {}) } });
        return `Auftrag ${u.number} geändert.\n${await orderText(u.id)}`;
      }
    }
  } catch (e) {
    if (e instanceof z.ZodError) return `Eingabe ungültig: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof OrderError || e instanceof PhaseError) return e.message;
    throw e;
  }
  return "Unbekannte Aktion.";
}

async function findCustomer(ref: string) {
  const r = ref.trim();
  const byId = await db.customer.findUnique({ where: { id: r } }).catch(() => null);
  if (byId) return byId;
  const list = await db.customer.findMany({ where: { archived: false, name: { contains: r, mode: "insensitive" } }, take: 4 });
  if (list.length === 1) return list[0];
  if (list.length > 1) throw new CrmError(`Mehrere Kunden passen zu „${r}“: ${list.map((c) => `${c.name} (id ${c.id})`).join(", ")}. Bitte genauer angeben.`);
  throw new CrmError(`Kein Kunde „${r}“ gefunden. Neue Kunden legt kunde_anlegen an.`);
}

async function runCrm(i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    const q = z
      .object({
        aktion: z.enum(["akte", "notiz", "wiedervorlagen", "erledigt", "anfrage"]),
        kunde: z.string().trim().min(2).max(120).optional(),
        art: z.enum(NOTE_KINDS).optional(),
        text: z.string().trim().max(4000).optional(),
        wiedervorlage: ymd.optional(),
        mitarbeiter: z.string().trim().max(80).optional(),
        bis: ymd.optional(),
        id: z.cuid().optional(),
        titel: z.string().trim().min(2).max(200).optional(),
      })
      .parse(i);
    const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true } });
    switch (q.aktion) {
      case "akte": {
        if (!q.kunde) return "Welcher Kunde?";
        return customerFileText((await findCustomer(q.kunde)).id);
      }
      case "notiz": {
        if (!q.kunde || !q.text) return "kunde und text angeben.";
        const c = await findCustomer(q.kunde);
        const u = q.mitarbeiter ? await findUserByName(q.mitarbeiter) : null;
        await addNote({ customerId: c.id, kind: q.art ?? "NOTIZ", text: q.text, followUp: q.wiedervorlage, assigneeId: u?.id ?? (q.wiedervorlage ? me.id : null), authorName: `${me.name} (über Jarvis)` });
        return `In der Kundenakte ${c.name} festgehalten${q.wiedervorlage ? `, Wiedervorlage am ${formatDate(berlinDateTime(q.wiedervorlage))}${u ? ` für ${u.name}` : ""}` : ""}. [Kundenakte](/buchhaltung/kunden/${c.id})`;
      }
      case "wiedervorlagen": {
        const until = q.bis ? berlinDateTime(q.bis, "23:59") : new Date(Date.now() + 7 * 86400_000);
        const list = await dueFollowUps(until, 40);
        if (!list.length) return "Keine offenen Wiedervorlagen im Zeitraum.";
        return list.map((n) => `- ${formatDate(n.followUpAt)}${n.followUpAt! < new Date() ? " ⚠" : ""} · ${n.customer.name}: ${n.text}${n.assignee ? ` · ${n.assignee.name}` : ""} · id ${n.id}`).join("\n");
      }
      case "erledigt": {
        if (!q.id) return "Wiedervorlagen-ID fehlt.";
        const r = await db.customerNote.updateMany({ where: { id: q.id, followUpDone: null }, data: { followUpDone: new Date() } });
        return r.count ? "Wiedervorlage erledigt." : "Nicht gefunden oder schon erledigt.";
      }
      case "anfrage": {
        if (!q.kunde || !q.titel) return "kunde und titel angeben.";
        const c = await findCustomer(q.kunde);
        const p = await newInquiry({ customerId: c.id, title: q.titel, description: q.text, userId: me.id, userName: `${me.name} (über Jarvis)` });
        return `Anfrage „${p.name}“ für ${c.name} angelegt (Projekt in Phase Kundenanfrage). Nächster Schritt: Angebot schreiben. [Projekt öffnen](/projekte/${p.id}) · Projekt-ID ${p.id}`;
      }
    }
  } catch (e) {
    if (e instanceof z.ZodError) return `Eingabe ungültig: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof CrmError || e instanceof PhaseError) return e.message;
    throw e;
  }
  return "Unbekannte Aktion.";
}
