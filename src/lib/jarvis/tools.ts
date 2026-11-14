import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, formatDateTime, todayYmd } from "@/lib/berlin";
import { companyProfile } from "@/lib/company";
import { AREA_LABEL, areasOf, TOOL_AREA } from "@/lib/rights-shared";
import { unbookedReceiptsWhere } from "@/lib/buchhaltung/purchases";
import { BOOK_TOOLS, BOOK_TOOL_NAMES, bookOverview, runBookTool } from "./book-tools";
import { MAIL_TOOLS, MAIL_TOOL_NAMES, runMailTool } from "./mail-tools";
import { eventLine, todayEvents } from "@/lib/calendar";
import { createJob, PcError } from "@/lib/pc";
import { WORK_TOOLS, WORK_TOOL_NAMES, runWorkTool } from "./work-tools";
import { TEAM_TOOLS, TEAM_TOOL_NAMES, runTeamTool } from "./team-tools";
import { SUPPLIER_TOOLS, SUPPLIER_TOOL_NAMES, runSupplierTool } from "./supplier-tools";
import { STOCK_TOOLS, STOCK_TOOL_NAMES, runStockTool } from "./stock-tools";
import { fmtQty, lowStock } from "@/lib/stock";
import { ERP_TOOLS, ERP_TOOL_NAMES, runErpTool } from "./erp-tools";
import { EPS_TOOLS, EPS_TOOL_NAMES, runEpsTool } from "./eps-tools";

// Werkzeuge von Jarvis. Lesen läuft sofort; Festschreiben, Senden, Mahnen, Storno und Mails nur als Freigabe-Karte.
// Interne Aufgaben/Gedächtnis darf Jarvis direkt ändern (harmlos, sichtbar).

export type ToolCtx = { userId: string; chatId: string; proposed: string[] };

type Def = Anthropic.Tool;

const str = (description: string) => ({ type: "string" as const, description });
const num = (description: string) => ({ type: "number" as const, description });

export const TOOLS: Def[] = [
  { name: "tagesueberblick", description: "Überblick für heute: fällige Aufgaben, überfällige und offene Rechnungen (Summen), offene Angebote. Für „Was steht an?“, „Wie sieht’s aus?“, Morgen-Briefing.", input_schema: { type: "object", properties: {} } },
  { name: "firmendaten", description: "Stammdaten und Leistungen von ProMont (Adresse, Geschäftsführung, Leistungen, Steuernummern).", input_schema: { type: "object", properties: {} } },
  ...BOOK_TOOLS,
  {
    name: "aufgaben",
    description: "Interne Aufgaben des Teams: anzeigen, anlegen (mit Datum/Uhrzeit → Erinnerung per Push) oder erledigen.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "anlegen", "erledigt"] },
        titel: str("Titel (anlegen)"),
        notiz: str("Notiz (anlegen)"),
        datum: str("fällig am JJJJ-MM-TT (anlegen, optional)"),
        uhrzeit: str("HH:MM (anlegen, optional → Erinnerung)"),
        id: str("Aufgaben-ID (erledigt)"),
      },
      required: ["aktion"],
    },
  },
  {
    name: "am_pc",
    description: "Auftrag an den Windows-PC mit der Jarvis-App geben: Programme bedienen (auch CAD), Dateien suchen/öffnen/lesen, Zeichnungen auswerten, Dinge am Bildschirm erledigen. Jarvis arbeitet dort selbstständig und fragt vor Maus/Tastatur nach. Für alles, was nur am Computer geht („öffne am PC …“, „such die Zeichnung …“, „exportier aus dem CAD …“).",
    input_schema: { type: "object", properties: { auftrag: str("Was am PC passieren soll – vollständig und konkret, mit Dateinamen/Kunden/Zielen") }, required: ["auftrag"] },
  },
  { name: "merken", description: "Dauerhaft merken, z. B. Vorlieben, Abläufe, Preise, Kundenbesonderheiten („Merk dir …“).", input_schema: { type: "object", properties: { text: str("Was gemerkt werden soll, als ganzer Satz") }, required: ["text"] } },
  { name: "vergessen", description: "Einen gemerkten Eintrag löschen.", input_schema: { type: "object", properties: { id: str("ID aus dem Gedächtnis-Block") }, required: ["id"] } },
  ...MAIL_TOOLS,
  ...WORK_TOOLS,
  ...TEAM_TOOLS,
  ...SUPPLIER_TOOLS,
  ...STOCK_TOOLS,
  ...ERP_TOOLS,
  ...EPS_TOOLS,
];

async function overview(userId: string) {
  const end = berlinDateTime(todayYmd(), "23:59");
  const tasks = await db.task.findMany({ where: { doneAt: null, dueAt: { lte: end } }, orderBy: { dueAt: "asc" }, take: 15 });
  const parts = [`Heute: ${formatDate(new Date())}`];
  parts.push(tasks.length ? `Fällige Aufgaben (${tasks.length}):\n${tasks.map((t) => `- ${t.title}${t.dueAt ? ` (${t.dueHasTime ? formatDateTime(t.dueAt) : formatDate(t.dueAt)})` : ""} · id ${t.id}`).join("\n")}` : "Keine fälligen Aufgaben.");
  const events = await todayEvents();
  parts.push(events.length ? `Termine heute:\n${events.map((e) => `- ${eventLine(e)}`).join("\n")}` : "Keine Termine heute.");
  const low = await lowStock(15);
  if (low.length) parts.push(`Lager unter Mindestbestand (${low.length}): ${low.map((i) => `${i.name} (noch ${fmtQty(i.quantity, i.unit)})`).join(", ")} – [Lager](/lager).`);
  const openReceipts = await db.storedFile.count({ where: await unbookedReceiptsWhere() });
  if (openReceipts) parts.push(`${openReceipts} fotografierte Belege noch nicht als Ausgabe gebucht ([Ausgaben](/buchhaltung/ausgaben)).`);
  if ((await userAreas(userId)).includes("buchhaltung")) parts.push(await bookOverview());
  return parts.join("\n\n");
}

const taskInput = z.object({ aktion: z.enum(["liste", "anlegen", "erledigt"]), titel: z.string().max(300).optional(), notiz: z.string().max(2000).optional(), datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), uhrzeit: z.string().regex(/^\d{1,2}:\d{2}$/).optional(), id: z.string().optional() });

async function tasks(input: unknown, userId: string) {
  const t = taskInput.parse(input);
  if (t.aktion === "liste") {
    const list = await db.task.findMany({ where: { doneAt: null }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 30 });
    return list.length ? list.map((x) => `- ${x.title}${x.dueAt ? ` · ${x.dueHasTime ? formatDateTime(x.dueAt) : formatDate(x.dueAt)}` : ""} · id ${x.id}`).join("\n") : "Keine offenen Aufgaben.";
  }
  if (t.aktion === "anlegen") {
    if (!t.titel) return "Titel fehlt.";
    const dueAt = t.datum ? berlinDateTime(t.datum, t.uhrzeit ? t.uhrzeit.padStart(5, "0") : "00:00") : null;
    const x = await db.task.create({ data: { title: t.titel, notes: t.notiz, dueAt, dueHasTime: Boolean(t.datum && t.uhrzeit), createdById: userId } });
    return `Aufgabe angelegt (id ${x.id})${dueAt ? `, fällig ${x.dueHasTime ? formatDateTime(dueAt) : formatDate(dueAt)}` : ""}. Sichtbar unter [Aufgaben](/aufgaben).`;
  }
  if (!t.id) return "ID fehlt.";
  const r = await db.task.updateMany({ where: { id: t.id, doneAt: null }, data: { doneAt: new Date() } });
  return r.count ? "Aufgabe erledigt." : "Aufgabe nicht gefunden oder schon erledigt.";
}

/** Auftrag an den PC (Computer-Steuerung) */
async function amPc(auftrag: string, ctx: ToolCtx) {
  if (auftrag.trim().length < 3) return "Was soll am PC passieren?";
  const chat = await db.chat.findUnique({ where: { id: ctx.chatId }, select: { source: true } });
  try {
    const job = await createJob(ctx.userId, auftrag, { origin: chat?.source === "windows" ? "pc" : "remote" });
    return `Auftrag an den PC gegeben (id ${job.id}). Jarvis arbeitet dort jetzt selbstständig; Fortschritt, Rückfragen und Bildschirm unter [Computer](/pc?auftrag=${job.id}).`;
  } catch (e) {
    return e instanceof PcError ? e.message : "Auftrag konnte nicht angelegt werden.";
  }
}

/** Gemerkte Fakten für den System-Prompt (neueste 60) */
export async function memoryBlock() {
  const m = await db.memory.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  return m.length ? `\n\nGedächtnis (vom Team gemerkt):\n${m.map((x) => `- ${x.text} (id ${x.id})`).join("\n")}` : "";
}

/** Rollen & Rechte: darf dieser Nutzer das Werkzeug benutzen? */
export async function userAreas(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, funktion: true } });
  return u ? areasOf(u) : [];
}

/** Werkzeuge, die dieser Nutzer sehen darf (Reihenfolge bleibt gleich) */
export async function toolsFor(userId: string) {
  const areas = await userAreas(userId);
  return TOOLS.filter((t) => !TOOL_AREA[t.name] || areas.includes(TOOL_AREA[t.name]));
}

export async function runTool(name: string, input: unknown, ctx: ToolCtx): Promise<string> {
  const i = (input ?? {}) as Record<string, unknown>;
  const need = TOOL_AREA[name];
  if (need && !(await userAreas(ctx.userId)).includes(need)) return `Keine Berechtigung: ${AREA_LABEL[need]} ist für deine Funktion nicht freigegeben. Bitte einen Administrator fragen.`;
  if (MAIL_TOOL_NAMES.has(name)) return runMailTool(name, i, ctx);
  if (SUPPLIER_TOOL_NAMES.has(name)) return runSupplierTool(name, i, ctx);
  if (STOCK_TOOL_NAMES.has(name)) return runStockTool(name, i, ctx);
  if (EPS_TOOL_NAMES.has(name)) return runEpsTool(name, i, ctx);
  if (ERP_TOOL_NAMES.has(name)) return runErpTool(name, i).catch((e) => (e instanceof z.ZodError ? `Eingabe ungültig: ${e.issues.map((x) => x.message).join("; ")}` : e instanceof Error ? e.message : "Fehler."));
  if (TEAM_TOOL_NAMES.has(name)) return runTeamTool(name, i, ctx).catch((e) => (e instanceof z.ZodError ? `Eingabe ungültig: ${e.issues.map((x) => x.message).join("; ")}` : e instanceof Error ? e.message : "Fehler."));
  if (WORK_TOOL_NAMES.has(name)) return runWorkTool(name, i, ctx).catch((e) => (e instanceof z.ZodError ? `Eingabe ungültig: ${e.issues.map((x) => x.message).join("; ")}` : e instanceof Error ? e.message : "Fehler."));
  if (name === "am_pc") return amPc(String(i.auftrag ?? ""), ctx);
  if (BOOK_TOOL_NAMES.has(name)) return runBookTool(name, i, ctx);
  try {
    switch (name) {
      case "tagesueberblick":
        return await overview(ctx.userId);
      case "firmendaten":
        return companyProfile();
      case "aufgaben":
        return await tasks(i, ctx.userId);
      case "merken": {
        const text = z.string().trim().min(3).max(1000).parse(i.text);
        const m = await db.memory.create({ data: { text, createdBy: ctx.userId } });
        return `Gemerkt (id ${m.id}).`;
      }
      case "vergessen": {
        const r = await db.memory.deleteMany({ where: { id: String(i.id ?? "") } });
        return r.count ? "Gelöscht." : "Nicht gefunden.";
      }
      default:
        return `Unbekanntes Werkzeug ${name}.`;
    }
  } catch (e) {
    if (e instanceof z.ZodError) return `Ungültige Eingabe: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    console.error(`[jarvis] Werkzeug ${name}:`, e);
    return "Fehler beim Abrufen.";
  }
}

export { addDaysYmd, berlinParts };
