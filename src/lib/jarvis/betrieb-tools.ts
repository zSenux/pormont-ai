import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { planRoutes, routeText } from "@/lib/route";
import { bauabzugCheck, createContract, expiringNuDocs, expiryLine, listSubcontractors, NuError, nuDetailText, nuLine } from "@/lib/nachunternehmer";
import { BAGATELL_EUR, BAUABZUG_PCT } from "@/lib/nachunternehmer-shared";
import { reportText, yearReport } from "@/lib/auswertung";
import { capacityText, capacityWeeks, fitCheck, fmtH, hoursFromQuote } from "@/lib/kapazitaet";
import { dunningProposals, proposalLine } from "@/lib/buchhaltung/mahnwesen";
import { empDocLine, expiringEmployeeDocs, personalText, whoHas } from "@/lib/personal";
import type { ToolCtx } from "./tools";

// Betriebs-Werkzeuge: Routenplanung, Nachunternehmer, Jahresauswertung, Kapazität Werkstatt, Mahnvorschläge, Personalakte.
// Lesend bzw. interne Daten. Mahnungen sendet Jarvis nie selbst (mahnen = Freigabe-Karte, freigeben darf nur ein Admin);
// die Personalakte zeigt Sensibles nur Administratoren.

const str = (description: string) => ({ type: "string" as const, description });
const num = (description: string) => ({ type: "number" as const, description });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");

export const BETRIEB_TOOLS: Anthropic.Tool[] = [
  {
    name: "route",
    description: "Routenplanung Montage: Touren eines Tages je Fahrzeug ab der Werkstatt (Montagen + Kalendertermine mit Adresse) mit kürzester Reihenfolge, Fahrzeit, km und Google-Maps-Link fürs Handy. Für „Wie fahren wir morgen?“, „Route für Donnerstag“.",
    input_schema: {
      type: "object",
      properties: {
        datum: str("Tag JJJJ-MM-TT (Standard heute)"),
        modus: { type: "string", enum: ["optimal", "zeit"], description: "optimal = kürzeste Fahrzeit (Standard), zeit = nach geplanter Uhrzeit" },
        abfahrt: str("Abfahrt HH:MM (Standard 07:00)"),
        aufenthalt: num("Minuten je Baustelle (Standard 90)"),
        zurueck: { type: "boolean", description: "Rückfahrt zur Werkstatt einrechnen (Standard ja)" },
      },
    },
  },
  {
    name: "nachunternehmer",
    description: "Nachunternehmer/Subunternehmer: liste (mit Ampel der Nachweise), details, ablauf (Nachweise, die in 30 Tagen ablaufen), pruefen (darf ohne 15 % Bauabzugsteuer gezahlt werden? § 48b-Freistellung), vertrag (Vertrag NU-… anlegen).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "details", "ablauf", "pruefen", "vertrag"] },
        suche: str("liste/details/pruefen/vertrag: Name oder Gewerk"),
        id: str("Nachunternehmer-ID (statt suche)"),
        betrag: num("pruefen: Rechnungsbetrag brutto in Euro"),
        titel: str("vertrag: Leistung"),
        projekt_id: str("vertrag: Projekt-ID (optional)"),
        netto: num("vertrag: Auftragssumme netto in Euro"),
        beginn: str("vertrag: JJJJ-MM-TT"),
        ende: str("vertrag: JJJJ-MM-TT"),
      },
      required: ["aktion"],
    },
  },
  {
    name: "auswertung",
    description: "Jahresauswertung: Umsatz, profitabelste Kunden, Produktgruppen (Treppen, Geländer, Tore …) nach Deckungsbeitrag, umsatzstärkste Positionen und – nur für Admin/Geschäftsführung – Monteure (Stunden, DB-Anteil). Zahlen nur aus diesem Werkzeug.",
    input_schema: { type: "object", properties: { jahr: num("Jahr, Standard aktuelles Jahr"), anzahl: num("Top-N, Standard 5") } },
  },
  {
    name: "kapazitaet",
    description: "Kapazität der Werkstatt: wochen (Auslastung der nächsten Wochen in %, wer fehlt) oder passt (passt ein neuer Auftrag mit X Werkstattstunden bis Datum rein? Stunden auch aus einem Angebot).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["wochen", "passt"] },
        wochen: num("wochen: Anzahl (Standard 8)"),
        stunden: num("passt: Werkstattstunden"),
        angebot_id: str("passt: Angebots-ID statt Stunden (Std.-Positionen oder Schätzung)"),
        bis: str("passt: gewünscht fertig bis JJJJ-MM-TT"),
      },
      required: ["aktion"],
    },
  },
  {
    name: "mahnvorschlaege",
    description: "Mahnwesen: welche Rechnungen jetzt die nächste Mahnstufe brauchen (Erinnerung → 1. → 2. Mahnung) und was demnächst fällig wird. Gesendet wird nur nach Freigabe durch die Geschäftsführung – auf der Seite oder per mahnen (Freigabe-Karte).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "personalakte",
    description: "Digitale Personalakte: ablauf (Führerscheine, Qualifikationen, Unterweisungen, Vorsorge, Verträge, die ablaufen bzw. Kontrolle fällig), mitarbeiter (Akte eines Mitarbeiters), wer_hat (wer hat Staplerschein/Schweißerprüfung/Klasse CE …), meine (eigene Qualifikationen). Sensibles (Verträge, Lohn, Vorsorge, private Daten) nur für Administratoren.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["ablauf", "mitarbeiter", "wer_hat", "meine"] },
        name: str("mitarbeiter: Name"),
        suche: str("wer_hat: Qualifikation, z. B. „Stapler“, „CE“, „9606“"),
        tage: num("ablauf: Tage voraus (Standard 30)"),
      },
      required: ["aktion"],
    },
  },
];
export const BETRIEB_TOOL_NAMES = new Set(BETRIEB_TOOLS.map((t) => t.name));

async function me(ctx: ToolCtx) {
  return db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true, role: true, funktion: true } });
}

async function findSub(i: { id?: string; suche?: string }) {
  if (i.id) return db.subcontractor.findUnique({ where: { id: i.id } });
  if (!i.suche) return null;
  const hits = await db.subcontractor.findMany({ where: { OR: [{ name: { contains: i.suche, mode: "insensitive" } }, { trade: { contains: i.suche, mode: "insensitive" } }] }, take: 5 });
  return hits.length === 1 ? hits[0] : hits.length ? hits : null;
}

export async function runBetriebTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    if (name === "route") {
      const q = z.object({ datum: ymd.optional(), modus: z.enum(["optimal", "zeit"]).optional(), abfahrt: z.string().regex(/^\d{1,2}:\d{2}$/).optional(), aufenthalt: z.number().min(0).max(600).optional(), zurueck: z.boolean().optional() }).parse(i);
      const r = await planRoutes(q.datum ?? todayYmd(), { mode: q.modus, depart: q.abfahrt?.padStart(5, "0"), stay: q.aufenthalt, back: q.zurueck });
      return routeText(r);
    }

    if (name === "nachunternehmer") {
      const q = z.object({ aktion: z.enum(["liste", "details", "ablauf", "pruefen", "vertrag"]), suche: z.string().max(100).optional(), id: z.string().max(40).optional(), betrag: z.number().min(0).max(10_000_000).optional(), titel: z.string().max(200).optional(), projekt_id: z.string().max(40).optional(), netto: z.number().min(0).max(10_000_000).optional(), beginn: ymd.optional(), ende: ymd.optional() }).parse(i);
      if (q.aktion === "liste") {
        const list = await listSubcontractors({ q: q.suche });
        return list.length ? `${list.length} Nachunternehmer:\n${list.map(nuLine).join("\n")}\n[Nachunternehmer](/nachunternehmer)` : "Keine Nachunternehmer gefunden. Anlegen unter [Nachunternehmer](/nachunternehmer).";
      }
      if (q.aktion === "ablauf") {
        const docs = await expiringNuDocs();
        return docs.length ? `${docs.length} Nachweise laufen in 30 Tagen ab oder sind abgelaufen:\n${docs.map(expiryLine).join("\n")}` : "Keine Nachweise laufen in den nächsten 30 Tagen ab.";
      }
      const s = await findSub(q);
      if (!s) return "Nachunternehmer nicht gefunden – erst mit liste suchen.";
      if (Array.isArray(s)) return `Mehrere Treffer, bitte genauer:\n${s.map((x) => `- ${x.name}${x.trade ? ` (${x.trade})` : ""} · id ${x.id}`).join("\n")}`;
      if (q.aktion === "details") return nuDetailText(s.id);
      if (q.aktion === "pruefen") {
        const c = await bauabzugCheck(s.id, q.betrag ?? null);
        if (c.exempt) return `${s.name}: Freistellung § 48b ist gültig – Zahlung ohne Steuerabzug möglich. [Nachweise](/nachunternehmer/${s.id})`;
        return `${s.name}: KEINE gültige Freistellung § 48b. ${c.deduct ? `Bei Bauleistungen ${BAUABZUG_PCT} % der Rechnung (brutto) einbehalten und ans Finanzamt abführen${c.deduction ? ` – bei ${q.betrag!.toLocaleString("de-DE")} € sind das ${c.deduction.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}` : ""}.` : `Bisher unter ${BAGATELL_EUR.toLocaleString("de-DE")} € im Jahr (Bagatellgrenze) – kein Abzug nötig, solange es dabei bleibt.`} Am besten aktuelle Bescheinigung anfordern. Keine Steuerberatung. [Nachweise](/nachunternehmer/${s.id})`;
      }
      if (!q.titel) return "Für den Vertrag fehlt die Leistung (titel).";
      const k = await createContract({ subcontractorId: s.id, projectId: q.projekt_id || null, title: q.titel, amountNet: q.netto ?? null, startDate: q.beginn ? berlinDateTime(q.beginn) : null, endDate: q.ende ? berlinDateTime(q.ende) : null }, { name: `${(await me(ctx)).name} (über Jarvis)` });
      return `Vertrag ${k.number} mit ${s.name} angelegt (${q.titel}). [öffnen](/nachunternehmer/${s.id})`;
    }

    if (name === "auswertung") {
      const u = await me(ctx);
      const q = z.object({ jahr: z.number().int().min(2000).max(2100).optional(), anzahl: z.number().int().min(1).max(20).optional() }).parse(i);
      const r = await yearReport(q.jahr ?? berlinParts().y);
      return reportText(r, u.role === "ADMIN" || u.funktion === "GF", q.anzahl ?? 5);
    }

    if (name === "kapazitaet") {
      const q = z.object({ aktion: z.enum(["wochen", "passt"]), wochen: z.number().int().min(1).max(26).optional(), stunden: z.number().min(0.5).max(5000).optional(), angebot_id: z.string().max(40).optional(), bis: ymd.optional() }).parse(i);
      if (q.aktion === "wochen") return capacityText(await capacityWeeks(q.wochen ?? 8));
      let hours = q.stunden ?? 0, note = "";
      if (q.angebot_id) {
        const h = await hoursFromQuote(q.angebot_id);
        if (!h) return "Angebot nicht gefunden.";
        hours = h.hours;
        note = ` (aus Angebot ${h.doc.number ?? "Entwurf"}${h.estimated ? ", geschätzt über 40 % Lohnanteil – besser echte Stunden nennen" : ""})`;
      }
      if (!hours) return "Wie viele Werkstattstunden hat der Auftrag?";
      const f = await fitCheck(hours, q.bis ?? null);
      if (!f.finish) return `${fmtH(hours)}${note} passen im nächsten halben Jahr nicht in die freie Kapazität. [Kapazität](/fertigung/kapazitaet)`;
      const end = formatDate(berlinDateTime(f.finish.end));
      return `${fmtH(hours)}${note}: ${f.ok ? "passt" : "passt NICHT bis zum Wunschtermin"} – frühestens fertig in KW ${f.finish.kw} (bis ${end})${q.bis ? `, gewünscht ${formatDate(berlinDateTime(q.bis))}` : ""}. Verteilung: ${f.used.map((x) => `KW ${x.kw} ${Math.round(x.hours)} h`).join(", ")}. Karten ohne Termin sind nicht eingerechnet. [Kapazität](/fertigung/kapazitaet?stunden=${hours}${q.bis ? `&bis=${q.bis}` : ""})`;
    }

    if (name === "mahnvorschlaege") {
      const { items, due } = await dunningProposals();
      if (!items.length) return "Keine Rechnung braucht gerade eine Mahnung.";
      const soon = items.filter((p) => p.state === "bald");
      const rest = items.filter((p) => !["faellig", "ungesendet", "bald"].includes(p.state));
      return [
        due.length ? `${due.length} zur Freigabe:` : "Gerade nichts zur Freigabe.",
        ...due.map(proposalLine),
        soon.length ? `\nDemnächst (7 Tage):` : null,
        ...soon.map(proposalLine),
        rest.length ? `\nSonstige:` : null,
        ...rest.map(proposalLine),
        "\nFreigeben darf nur die Geschäftsführung: auf [Mahnungen](/buchhaltung/mahnwesen) oder per mahnen (Freigabe-Karte).",
      ].filter((x) => x !== null).join("\n");
    }

    if (name === "personalakte") {
      const u = await me(ctx);
      const admin = u.role === "ADMIN";
      const q = z.object({ aktion: z.enum(["ablauf", "mitarbeiter", "wer_hat", "meine"]), name: z.string().max(100).optional(), suche: z.string().min(2).max(100).optional(), tage: z.number().int().min(1).max(365).optional() }).parse(i);
      if (q.aktion === "meine") return personalText(u.id, false);
      if (q.aktion === "wer_hat") {
        if (!q.suche) return "Welche Qualifikation?";
        const hits = await whoHas(q.suche);
        if (!hits.length) return `Niemand mit „${q.suche}“ eingetragen.`;
        return `${hits.length} Einträge zu „${q.suche}“:\n${hits.map((d) => empDocLine(d)).join("\n")}`;
      }
      if (q.aktion === "ablauf") {
        const docs = await expiringEmployeeDocs(q.tage ?? 30, admin ? {} : { userId: u.id, sensitive: false });
        if (!docs.length) return `In den nächsten ${q.tage ?? 30} Tagen läuft nichts ab.`;
        return `${docs.length} Einträge laufen ab bzw. Kontrolle fällig:\n${docs.map((d) => empDocLine(d)).join("\n")}${admin ? "\n[Personalakte](/personal)" : ""}`;
      }
      if (!admin) return "Die Personalakte anderer Mitarbeiter sehen nur Administratoren. Deine eigenen Qualifikationen: aktion meine.";
      if (!q.name) return "Wessen Akte?";
      const hits = await db.user.findMany({ where: { name: { contains: q.name, mode: "insensitive" } }, select: { id: true, name: true }, take: 5 });
      if (hits.length !== 1) return hits.length ? `Mehrere Treffer: ${hits.map((h) => h.name).join(", ")}` : "Mitarbeiter nicht gefunden.";
      return personalText(hits[0].id, true);
    }
    return "Unbekanntes Werkzeug.";
  } catch (e) {
    if (e instanceof z.ZodError) return `Eingabe prüfen: ${e.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`;
    if (e instanceof NuError) return e.message;
    throw e;
  }
}
