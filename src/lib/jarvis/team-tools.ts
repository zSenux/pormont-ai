import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { formatHours } from "@/lib/hours";
import { netMinutes, runningEntry, thisMonth, monthRange } from "@/lib/zeiten";
import { KIND_LABEL, STATUS_LABEL, euro, kmAmount, mealAmount, type ExpenseKind } from "@/lib/spesen";
import { STAGE_LABEL } from "@/lib/akquise/stages";
import type { ToolCtx } from "./tools";

// Stempeluhr, Spesen und Neukunden-Akquise für Jarvis.
// Stempeln/Spesen betreffen immer nur den angemeldeten Nutzer. Freigaben von Spesen macht ein Administrator in der Oberfläche.

const str = (description: string) => ({ type: "string" as const, description });

export const TEAM_TOOLS: Anthropic.Tool[] = [
  {
    name: "stempeluhr",
    description: "Arbeitszeit des Nutzers: Status (eingestempelt?, Stunden diese Woche/Monat), kommen (einstempeln) oder gehen (ausstempeln mit Pause).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["status", "kommen", "gehen"], description: "Standard status" },
        projekt_id: str("kommen: Projekt-ID (optional)"),
        pause_min: { type: "number", description: "gehen: Pause in Minuten (gesetzliche Mindestpause wird ohnehin abgezogen)" },
        notiz: str("optional"),
      },
    },
  },
  {
    name: "spesen",
    description: "Spesen des Nutzers: liste (dieser Monat mit Status) oder einreichen von Verpflegungspauschale bzw. Kilometern. Auslagen/Hotel mit Beleg nur unter /spesen (Foto).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "verpflegung", "fahrt"], description: "Standard liste" },
        tag: str("Tag JJJJ-MM-TT, Standard heute"),
        dauer: { type: "string", enum: ["TAG8", "REISE", "TAG24"], description: "verpflegung: TAG8 = eintägig > 8 Std., REISE = An-/Abreisetag, TAG24 = ganzer Tag" },
        fruehstueck: { type: "boolean" },
        mittag: { type: "boolean" },
        abend: { type: "boolean", description: "Mahlzeiten, die gestellt wurden (kürzen die Pauschale)" },
        km: { type: "number", description: "fahrt: gefahrene km mit eigenem Auto (Hin + Rück)" },
        beschreibung: str("Anlass bzw. Strecke"),
      },
    },
  },
  {
    name: "akquise",
    description: "Neukunden-Akquise (Interessenten-Pipeline): liste (offene, optional Suche), heute (heute nachfassen), notiz (Kontakt festhalten + Nachfass-Datum), anlegen (neuer Interessent). Werbe-Mails nur mit Einwilligung (§ 7 UWG) – sonst Anruf oder Brief vorschlagen.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "heute", "notiz", "anlegen"], description: "Standard liste" },
        suche: str("liste: Firma/Ort/Branche"),
        lead_id: str("notiz: ID aus liste"),
        art: { type: "string", enum: ["ANRUF", "TERMIN", "BRIEF", "MAIL", "NOTIZ"], description: "notiz: Art des Kontakts" },
        text: str("notiz: was besprochen wurde"),
        nachfassen: str("notiz: Datum JJJJ-MM-TT zum Nachfassen (optional)"),
        firma: str("anlegen: Firmenname"),
        branche: str("anlegen"),
        ort: str("anlegen"),
        telefon: str("anlegen"),
        ansprechpartner: str("anlegen"),
      },
    },
  },
];

export const TEAM_TOOL_NAMES = new Set(TEAM_TOOLS.map((t) => t.name));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum bitte als JJJJ-MM-TT");
const hm = (d: Date) => `${String(berlinParts(d).h).padStart(2, "0")}:${String(berlinParts(d).min).padStart(2, "0")}`;

export async function runTeamTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true } });
  switch (name) {
    case "stempeluhr": {
      const q = z.object({ aktion: z.enum(["status", "kommen", "gehen"]).default("status"), projekt_id: z.string().max(40).optional(), pause_min: z.number().int().min(0).max(480).optional(), notiz: z.string().trim().max(500).optional() }).parse(i);
      const run = await runningEntry(user.id);
      if (q.aktion === "kommen") {
        if (run?.startAt) return `Du bist schon seit ${hm(run.startAt)} Uhr eingestempelt.`;
        if (q.projekt_id && !(await db.project.findUnique({ where: { id: q.projekt_id }, select: { id: true } }))) return "Projekt nicht gefunden – erst mit projekte die ID holen.";
        await db.timeEntry.create({ data: { userId: user.id, projectId: q.projekt_id ?? null, day: berlinDateTime(todayYmd()), minutes: 0, startAt: new Date(), note: q.notiz ?? null } });
        return `Eingestempelt um ${hm(new Date())} Uhr. [Stunden](/stunden)`;
      }
      if (q.aktion === "gehen") {
        if (!run?.startAt) return "Du bist nicht eingestempelt. Nachtragen geht unter [Stunden](/stunden).";
        const m = netMinutes(run.startAt, new Date(), q.pause_min ?? 0);
        await db.timeEntry.update({ where: { id: run.id }, data: { endAt: new Date(), pauseMin: m.pause, minutes: m.net, ...(q.notiz ? { note: q.notiz } : {}) } });
        return `Ausgestempelt: ${formatHours(m.net)} (${hm(run.startAt)}–${hm(new Date())}, Pause ${m.pause} min). [Stunden](/stunden)`;
      }
      const r = monthRange(thisMonth());
      const week = addDaysYmd(todayYmd(), -((new Date(`${todayYmd()}T12:00:00Z`).getUTCDay() + 6) % 7));
      const [w, mo] = await Promise.all([
        db.timeEntry.aggregate({ _sum: { minutes: true }, where: { userId: user.id, kind: { in: ["ARBEIT", "FAHRT"] }, day: { gte: berlinDateTime(week) } } }),
        db.timeEntry.aggregate({ _sum: { minutes: true }, where: { userId: user.id, kind: { in: ["ARBEIT", "FAHRT"] }, day: { gte: r.from, lt: r.to } } }),
      ]);
      return `${run?.startAt ? `Eingestempelt seit ${hm(run.startAt)} Uhr${run.project ? ` (${run.project.name})` : ""}.` : "Nicht eingestempelt."} Diese Woche ${formatHours(w._sum.minutes ?? 0)}, diesen Monat ${formatHours(mo._sum.minutes ?? 0)}. [Stunden](/stunden)`;
    }

    case "spesen": {
      const q = z
        .object({ aktion: z.enum(["liste", "verpflegung", "fahrt"]).default("liste"), tag: ymd.optional(), dauer: z.enum(["TAG8", "REISE", "TAG24"]).optional(), fruehstueck: z.boolean().optional(), mittag: z.boolean().optional(), abend: z.boolean().optional(), km: z.number().int().min(1).max(5000).optional(), beschreibung: z.string().trim().max(300).optional() })
        .parse(i);
      if (q.aktion === "liste") {
        const r = monthRange(thisMonth());
        const rows = await db.expense.findMany({ where: { userId: user.id, day: { gte: r.from, lt: r.to } }, orderBy: { day: "asc" } });
        if (!rows.length) return "Diesen Monat noch keine Spesen. [Spesen](/spesen)";
        return `Deine Spesen diesen Monat:\n${rows.map((e) => `- ${formatDate(e.day)} · ${KIND_LABEL[e.kind as ExpenseKind]} · ${e.description} · ${euro(e.amountCents)} · ${STATUS_LABEL[e.status]}`).join("\n")}\nSumme ${euro(rows.filter((e) => e.status !== "ABGELEHNT").reduce((s, e) => s + e.amountCents, 0))}. [Spesen](/spesen)`;
      }
      const day = q.tag ?? todayYmd();
      if (day > todayYmd()) return "Spesen für zukünftige Tage gehen nicht.";
      let amountCents: number;
      if (q.aktion === "verpflegung") {
        if (!q.dauer) return "Wie lange warst du unterwegs: über 8 Std. an einem Tag, An-/Abreisetag oder ganzer Tag (24 Std.)?";
        if (await db.expense.findFirst({ where: { userId: user.id, kind: "VERPFLEGUNG", day: berlinDateTime(day), status: { not: "ABGELEHNT" } } })) return "Für diesen Tag ist schon eine Verpflegungspauschale eingetragen.";
        amountCents = mealAmount(q.dauer, { breakfast: q.fruehstueck, lunch: q.mittag, dinner: q.abend });
        if (!amountCents) return "Alle Mahlzeiten gestellt – es bleibt keine Pauschale.";
        await db.expense.create({ data: { userId: user.id, day: berlinDateTime(day), kind: "VERPFLEGUNG", description: q.beschreibung ?? "Verpflegung", mealDay: q.dauer, breakfast: !!q.fruehstueck, lunch: !!q.mittag, dinner: !!q.abend, amountCents } });
      } else {
        if (!q.km) return "Wie viele Kilometer bist du gefahren (Hin und Rück)?";
        amountCents = kmAmount(q.km);
        await db.expense.create({ data: { userId: user.id, day: berlinDateTime(day), kind: "FAHRT", description: q.beschreibung ?? "Dienstfahrt", km: q.km, amountCents } });
      }
      return `Eingereicht: ${euro(amountCents)} am ${formatDate(berlinDateTime(day))}. Ein Administrator gibt frei. [Spesen](/spesen)`;
    }

    case "akquise": {
      const q = z
        .object({
          aktion: z.enum(["liste", "heute", "notiz", "anlegen"]).default("liste"), suche: z.string().trim().max(80).optional(), lead_id: z.string().max(40).optional(),
          art: z.enum(["ANRUF", "TERMIN", "BRIEF", "MAIL", "NOTIZ"]).default("NOTIZ"), text: z.string().trim().max(4000).optional(), nachfassen: ymd.optional(),
          firma: z.string().trim().min(2).max(200).optional(), branche: z.string().trim().max(100).optional(), ort: z.string().trim().max(100).optional(), telefon: z.string().trim().max(60).optional(), ansprechpartner: z.string().trim().max(120).optional(),
        })
        .parse(i);
      if (q.aktion === "anlegen") {
        if (!q.firma) return "Wie heißt die Firma?";
        const l = await db.lead.create({ data: { name: q.firma, category: q.branche, city: q.ort, phone: q.telefon, contactName: q.ansprechpartner, createdById: user.id, activities: { create: { kind: "NOTIZ", text: "Über Jarvis angelegt.", userName: user.name } } } });
        return `Interessent angelegt: [${l.name}](/akquise/${l.id}) (id ${l.id}).`;
      }
      if (q.aktion === "notiz") {
        if (!q.lead_id || !q.text) return "Welcher Interessent (lead_id) und was soll ich notieren?";
        const l = await db.lead.findUnique({ where: { id: q.lead_id } });
        if (!l) return "Interessent nicht gefunden – erst mit akquise liste die ID holen.";
        await db.leadActivity.create({ data: { leadId: l.id, kind: q.art, text: q.text, userName: user.name } });
        const stage = l.stage === "NEU" && q.art !== "NOTIZ" ? (q.art === "TERMIN" ? "TERMIN" : "KONTAKTIERT") : l.stage === "KONTAKTIERT" && q.art === "TERMIN" ? "TERMIN" : null;
        await db.lead.update({ where: { id: l.id }, data: { ...(stage ? { stage } : {}), ...(q.nachfassen ? { nextFollowUpAt: berlinDateTime(q.nachfassen, "09:00") } : {}) } });
        return `Notiert bei [${l.name}](/akquise/${l.id})${stage ? `, Stufe jetzt ${STAGE_LABEL[stage]}` : ""}${q.nachfassen ? `, nachfassen am ${formatDate(berlinDateTime(q.nachfassen))}` : ""}.`;
      }
      const open = { stage: { notIn: ["GEWONNEN", "VERLOREN"] as ("GEWONNEN" | "VERLOREN")[] } };
      const where = q.aktion === "heute"
        ? { ...open, nextFollowUpAt: { lt: berlinDateTime(addDaysYmd(todayYmd(), 1)) } }
        : q.suche ? { OR: [{ name: { contains: q.suche, mode: "insensitive" as const } }, { city: { contains: q.suche, mode: "insensitive" as const } }, { category: { contains: q.suche, mode: "insensitive" as const } }] } : open;
      const rows = await db.lead.findMany({ where, orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }], take: 25 });
      if (!rows.length) return q.aktion === "heute" ? "Heute steht kein Nachfassen an. [Akquise](/akquise)" : "Keine passenden Interessenten. [Akquise](/akquise)";
      return `${q.aktion === "heute" ? "Heute nachfassen" : "Interessenten"}:\n${rows.map((l) => `- id ${l.id} · [${l.name}](/akquise/${l.id}) · ${STAGE_LABEL[l.stage]}${l.category ? ` · ${l.category}` : ""}${l.city ? ` · ${l.city}` : ""}${l.phone ? ` · ${l.phone}` : ""}${l.nextFollowUpAt ? ` · nachfassen ${formatDate(l.nextFollowUpAt)}` : ""}${l.emailConsentAt ? " · Mail erlaubt" : ""}`).join("\n")}`;
    }
  }
  return "Unbekanntes Werkzeug.";
}
