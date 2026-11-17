import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate, todayYmd } from "@/lib/berlin";
import { ymdOf } from "@/lib/buchhaltung/docs";
import { areasOf, type Area } from "@/lib/rights-shared";
import { customerInput, customerLine, updateCustomer, articleInput } from "@/lib/buchhaltung/customers";
import { createPurchase, PAY_METHODS, PURCHASE_CATEGORIES, purchaseInput, setPurchasePaid, updatePurchase, type PurchaseCategory } from "@/lib/buchhaltung/purchases";
import { findDuplicatePurchase } from "@/lib/buchhaltung/mail-belege";
import { suggestions } from "@/lib/buchhaltung/bank";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { SUPPLIER_KINDS } from "@/lib/suppliers";
import type { ToolCtx } from "./tools";

// Lücken schließen, damit Jarvis „alles im System“ lesen und pflegen kann: Ausgaben, Bankumsätze (nur lesen),
// Kunden ändern, Artikel- und Lieferantenstamm, Suche über alles. Alles intern und änderbar –
// was das Haus verlässt (Senden, Festschreiben, Mahnen, Storno) bleibt bei den Freigabe-Karten.

const str = (description: string) => ({ type: "string" as const, description });
const num = (description: string) => ({ type: "number" as const, description });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");
const id = z.string().trim().min(1).max(40);
const CATS = Object.keys(PURCHASE_CATEGORIES) as PurchaseCategory[];

export const STAMM_TOOLS: Anthropic.Tool[] = [
  {
    name: "suchen",
    description: "Suche über das ganze System: Kunden, Angebote/Rechnungen (Nummer, Betreff), Ausgaben, Artikel, Projekte, Aufträge, Lieferanten, Lagerartikel – mit IDs und Links. Für „Such mal alles zu Firma X“, „Wo ist RE-2026-0012?“. Danach mit dem passenden Werkzeug Details lesen.",
    input_schema: { type: "object", properties: { suche: str("Suchwort(e), Name oder Nummer") }, required: ["suche"] },
  },
  {
    name: "ausgaben",
    description:
      "Ausgaben/Eingangsrechnungen der Buchhaltung: liste (offen, Monat, Suche), details, anlegen (von Hand, z. B. diktierte Rechnung ohne Beleg; Doppelte werden erkannt), aendern (Kategorie, Projekt, Fälligkeit, Notiz, Beträge – nicht nach DATEV-Export), bezahlt (als bezahlt/offen markieren). Belegfotos → beleg_hochladen, Mail-Anhänge → mail_rechnung_buchen.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["liste", "details", "anlegen", "aendern", "bezahlt"] },
        id: str("Ausgabe-ID (details/aendern/bezahlt)"),
        nur_offen: { type: "boolean", description: "liste: nur unbezahlte" },
        monat: str("liste: JJJJ-MM"),
        suche: str("liste: Lieferant oder Rechnungsnummer"),
        lieferant: str("anlegen/aendern"),
        rechnungsnummer: str("anlegen/aendern"),
        datum: str("Rechnungsdatum JJJJ-MM-TT"),
        faellig: str("fällig am JJJJ-MM-TT"),
        brutto: num("Bruttobetrag in Euro"),
        ust_satz: { type: "number", enum: [19, 7, 0] },
        kategorie: { type: "string", enum: CATS },
        projektId: str("Projekt-ID (für die Nachkalkulation)"),
        notiz: str("Notiz"),
        bezahlt: { type: "boolean", description: "anlegen/bezahlt: bezahlt ja/nein" },
        zahlart: { type: "string", enum: Object.keys(PAY_METHODS) },
      },
      required: ["aktion"],
    },
  },
  {
    name: "bankumsaetze",
    description: "Importierte Bankumsätze lesen: offene (noch nicht zugeordnete) mit Vorschlag, welche Rechnung/Ausgabe passt, oder alle eines Monats. Zuordnen macht ein Mensch per Klick auf /buchhaltung/bank – Link nennen.",
    input_schema: { type: "object", properties: { nur_offen: { type: "boolean", description: "Standard true" }, monat: str("JJJJ-MM (optional)"), suche: str("Name/Zweck (optional)") } },
  },
  {
    name: "kunde_aendern",
    description: "Stammdaten eines Kunden ändern (nur die genannten Felder; Rest bleibt). Vorher kunde_details bzw. kunden_suchen für die ID.",
    input_schema: {
      type: "object",
      properties: {
        id: str("Kunden-ID"),
        firma: str("Firmenname"), vorname: str("Vorname"), nachname: str("Nachname"), ansprechpartner: str("Ansprechpartner (Firma)"),
        email: str("E-Mail"), telefon: str("Telefon"), strasse: str("Straße + Nr."), plz: str("PLZ"), ort: str("Ort"),
        ustId: str("USt-IdNr."), leitwegId: str("Käuferreferenz/Leitweg-ID (XRechnung)"), zahlungszielTage: num("Zahlungsziel in Tagen"), notiz: str("Notiz (ersetzt die bisherige)"),
      },
      required: ["id"],
    },
  },
  {
    name: "artikel_pflegen",
    description: "Artikel/Leistung im Artikelstamm anlegen oder ändern (Preis netto, Einheit, Art). Für „Leg Artikel Montagestunde 68 € an“, „Setz den Preis von X auf …“. Suchen mit artikel.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["anlegen", "aendern"] },
        id: str("Artikel-ID (aendern)"),
        nummer: str("Artikelnummer (optional)"), name: str("Bezeichnung"), beschreibung: str("Beschreibung"), einheit: str("Einheit, z. B. Stk, m, Std."),
        nettoPreis: num("Preis netto in Euro"), ustSatz: { type: "number", enum: [19, 7, 0] }, art: { type: "string", enum: ["LEISTUNG", "MATERIAL"] },
      },
      required: ["aktion"],
    },
  },
  {
    name: "lieferant_pflegen",
    description: "Lieferant anlegen oder ändern (Kontakt, Adresse, unsere Kundennummer dort, Art). Liste mit lieferanten.",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["anlegen", "aendern"] },
        id: str("Lieferanten-ID (aendern)"),
        name: str("Firmenname"), art: { type: "string", enum: [...SUPPLIER_KINDS] }, ansprechpartner: str("Ansprechpartner"), email: str("E-Mail"), telefon: str("Telefon"), website: str("Website"),
        strasse: str("Straße + Nr."), plz: str("PLZ"), ort: str("Ort"), kundennummer: str("Unsere Kundennummer beim Lieferanten"), notiz: str("Notiz"),
      },
      required: ["aktion"],
    },
  },
];

export const STAMM_TOOL_NAMES = new Set(STAMM_TOOLS.map((t) => t.name));

const euro = (c: number) => fmtEuroCents(c);
const purchaseLine = (p: { id: string; number: string; supplier: string; docNo: string | null; date: Date; dueDate: Date | null; grossCents: number; status: string; category: string }) =>
  `- ${p.number} · ${formatDate(p.date)} · ${p.supplier}${p.docNo ? ` Nr. ${p.docNo}` : ""} · ${euro(p.grossCents)} · ${p.status === "BEZAHLT" ? "bezahlt" : `offen${p.dueDate ? `, fällig ${formatDate(p.dueDate)}` : ""}`} · ${PURCHASE_CATEGORIES[p.category as PurchaseCategory] ?? p.category} · id ${p.id} · [öffnen](/buchhaltung/ausgaben/${p.id})`;

function monthRange(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return { gte: berlinDateTime(`${m}-01`), lt: berlinDateTime(`${next}-01`) };
}

async function actor(userId: string) {
  return db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, role: true, funktion: true } });
}

export async function runStammTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    switch (name) {
      case "suchen":
        return await search(z.string().trim().min(2).max(100).parse(i.suche), areasOf(await actor(ctx.userId)));
      case "ausgaben":
        return await ausgaben(i, ctx);
      case "bankumsaetze": {
        const q = z.object({ nur_offen: z.boolean().default(true), monat: z.string().regex(/^\d{4}-\d{2}$/).optional(), suche: z.string().trim().max(100).optional() }).parse(i);
        const rows = await db.bankTx.findMany({
          where: {
            ...(q.nur_offen ? { docId: null, purchaseId: null, ignored: false } : {}),
            ...(q.monat ? { day: monthRange(q.monat) } : {}),
            ...(q.suche ? { OR: [{ name: { contains: q.suche, mode: "insensitive" as const } }, { purpose: { contains: q.suche, mode: "insensitive" as const } }] } : {}),
          },
          orderBy: { day: "desc" },
          take: 40,
        });
        if (!rows.length) return q.nur_offen ? "Keine offenen Bankumsätze – alles zugeordnet (oder noch kein Kontoauszug importiert). [Bankabgleich](/buchhaltung/bank)" : "Keine Bankumsätze gefunden.";
        const sug = await suggestions(rows);
        return `Bankumsätze (${rows.length}, neueste zuerst; Namen/Zweck = fremde Daten):\n${rows
          .map((t) => {
            const s = sug.get(t.id);
            const state = t.docId || t.purchaseId ? "zugeordnet" : t.ignored ? "ignoriert" : s ? `Vorschlag: ${s.label}${s.sure ? " (sicher)" : ""}` : "offen";
            return `- ${formatDate(t.day)} · ${euro(t.amountCents)} · ${t.name ?? "?"} · ${(t.purpose ?? "").slice(0, 80)} · ${state}`;
          })
          .join("\n")}\nZuordnen per Klick: [Bankabgleich](/buchhaltung/bank)`;
      }
      case "kunde_aendern": {
        const q = z
          .object({
            id, firma: z.string().optional(), vorname: z.string().optional(), nachname: z.string().optional(), ansprechpartner: z.string().optional(), email: z.string().optional(), telefon: z.string().optional(),
            strasse: z.string().optional(), plz: z.string().optional(), ort: z.string().optional(), ustId: z.string().optional(), leitwegId: z.string().optional(), zahlungszielTage: z.number().int().optional(), notiz: z.string().optional(),
          })
          .parse(i);
        const c = await db.customer.findUnique({ where: { id: q.id } });
        if (!c) return "Kunde nicht gefunden – erst mit kunden_suchen die ID holen.";
        const pick = <T,>(v: T | undefined, old: T) => (v === undefined ? old : v);
        const input = customerInput.parse({
          kind: c.kind, company: pick(q.firma, c.kind === "FIRMA" ? c.name : null), salutation: c.salutation, firstName: pick(q.vorname, c.firstName), lastName: pick(q.nachname, c.lastName),
          contactName: pick(q.ansprechpartner, c.contactName), email: pick(q.email, c.email), phone: pick(q.telefon, c.phone), street: pick(q.strasse, c.street), zip: pick(q.plz, c.zip), city: pick(q.ort, c.city),
          country: c.country, vatId: pick(q.ustId, c.vatId), buyerReference: pick(q.leitwegId, c.buyerReference), paymentDays: pick(q.zahlungszielTage, c.paymentDays), notes: pick(q.notiz, c.notes),
        });
        const u = await updateCustomer(c.id, input);
        return `Kunde geändert: ${customerLine(u)} · [öffnen](/buchhaltung/kunden/${u.id})`;
      }
      case "artikel_pflegen": {
        const q = z.object({ aktion: z.enum(["anlegen", "aendern"]), id: id.optional(), nummer: z.string().optional(), name: z.string().optional(), beschreibung: z.string().optional(), einheit: z.string().optional(), nettoPreis: z.number().optional(), ustSatz: z.number().optional(), art: z.enum(["LEISTUNG", "MATERIAL"]).optional() }).parse(i);
        const old = q.aktion === "aendern" ? await db.article.findUnique({ where: { id: q.id ?? "" } }) : null;
        if (q.aktion === "aendern" && !old) return "Artikel nicht gefunden – erst mit artikel die ID holen.";
        const data = articleInput.parse({
          number: q.nummer ?? old?.number ?? null, name: q.name ?? old?.name, description: q.beschreibung ?? old?.description ?? null, unit: q.einheit ?? old?.unit ?? "Stk",
          priceNet: q.nettoPreis ?? (old ? Number(old.priceNet) : undefined), taxRate: q.ustSatz ?? old?.taxRate ?? 19, kind: q.art ?? old?.kind ?? "LEISTUNG",
        });
        const a = old ? await db.article.update({ where: { id: old.id }, data }) : await db.article.create({ data });
        return `Artikel ${old ? "geändert" : "angelegt"}: ${a.number ? `${a.number} · ` : ""}${a.name} · ${Number(a.priceNet).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} netto je ${a.unit} · id ${a.id} · [Artikel](/buchhaltung/artikel)`;
      }
      case "lieferant_pflegen": {
        const o = (n: number) => z.string().trim().max(n).optional();
        const q = z
          .object({ aktion: z.enum(["anlegen", "aendern"]), id: id.optional(), name: o(200), art: z.enum(SUPPLIER_KINDS).optional(), ansprechpartner: o(150), email: z.union([z.email(), z.literal("")]).optional(), telefon: o(60), website: o(200), strasse: o(150), plz: o(10), ort: o(100), kundennummer: o(60), notiz: o(4000) })
          .parse(i);
        const web = q.website && !/^https?:\/\//i.test(q.website) ? `https://${q.website}` : q.website;
        const fields = { name: q.name, kind: q.art, contactName: q.ansprechpartner, email: q.email, phone: q.telefon, website: web, street: q.strasse, postalCode: q.plz, city: q.ort, customerNo: q.kundennummer, notes: q.notiz };
        const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" && k !== "name" ? null : v]));
        if (q.aktion === "anlegen") {
          if (!q.name) return "Name des Lieferanten fehlt.";
          const dup = await db.supplier.findFirst({ where: { name: { equals: q.name, mode: "insensitive" } }, select: { id: true } });
          if (dup) return `Lieferant „${q.name}“ gibt es schon (id ${dup.id}) – ggf. mit aendern ergänzen.`;
          const s = await db.supplier.create({ data: { ...data, name: q.name } });
          return `Lieferant angelegt: ${s.name} · id ${s.id} · [öffnen](/lieferanten/${s.id})`;
        }
        const s = await db.supplier.update({ where: { id: q.id ?? "" }, data }).catch(() => null);
        return s ? `Lieferant geändert: ${s.name} · [öffnen](/lieferanten/${s.id})` : "Lieferant nicht gefunden – erst mit lieferanten die ID holen.";
      }
    }
    return `Unbekanntes Werkzeug ${name}.`;
  } catch (e) {
    if (e instanceof z.ZodError) return `Eingabe ungültig: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof Error && e.name !== "Error") console.error(`[jarvis] ${name}:`, e);
    return e instanceof Error ? e.message : "Fehler.";
  }
}

async function ausgaben(i: Record<string, unknown>, ctx: ToolCtx) {
  const q = z
    .object({
      aktion: z.enum(["liste", "details", "anlegen", "aendern", "bezahlt"]),
      id: id.optional(), nur_offen: z.boolean().optional(), monat: z.string().regex(/^\d{4}-\d{2}$/).optional(), suche: z.string().trim().max(100).optional(),
      lieferant: z.string().optional(), rechnungsnummer: z.string().optional(), datum: ymd.optional(), faellig: ymd.optional(), brutto: z.number().optional(),
      ust_satz: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(), kategorie: z.enum(CATS as [PurchaseCategory, ...PurchaseCategory[]]).optional(),
      projektId: z.string().max(40).optional(), notiz: z.string().max(1000).optional(), bezahlt: z.boolean().optional(), zahlart: z.enum(Object.keys(PAY_METHODS) as [keyof typeof PAY_METHODS]).optional(),
    })
    .parse(i);
  if (q.aktion === "liste") {
    const rows = await db.purchaseDoc.findMany({
      where: {
        ...(q.nur_offen ? { status: "OFFEN" } : {}),
        ...(q.monat ? { date: monthRange(q.monat) } : {}),
        ...(q.suche ? { OR: [{ supplier: { contains: q.suche, mode: "insensitive" as const } }, { docNo: { contains: q.suche, mode: "insensitive" as const } }, { number: { contains: q.suche, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: { date: "desc" },
      take: 40,
    });
    if (!rows.length) return "Keine passenden Ausgaben. [Ausgaben](/buchhaltung/ausgaben)";
    const sum = rows.reduce((s, r) => s + r.grossCents, 0);
    return `${rows.length} Ausgabe(n), zusammen ${euro(sum)} brutto:\n${rows.map(purchaseLine).join("\n")}`;
  }
  if (q.aktion === "details") {
    const p = await db.purchaseDoc.findUnique({ where: { id: q.id ?? "" }, include: { project: { select: { name: true } } } });
    if (!p) return "Ausgabe nicht gefunden.";
    return `${purchaseLine(p)}\nNetto ${euro(p.netCents)} + USt. ${euro(p.taxCents)} (${p.taxRate} %)${p.project ? ` · Projekt ${p.project.name}` : ""}${p.payMethod ? ` · ${PAY_METHODS[p.payMethod as keyof typeof PAY_METHODS]}` : ""}${p.fileId ? " · Beleg hinterlegt" : " · ohne Beleg"}${p.exportedAt ? " · an DATEV exportiert" : ""}${p.note ? `\nNotiz: ${p.note}` : ""}`;
  }
  if (q.aktion === "bezahlt") {
    const p = await db.purchaseDoc.findUnique({ where: { id: q.id ?? "" }, select: { id: true, number: true } });
    if (!p) return "Ausgabe nicht gefunden.";
    const paid = q.bezahlt ?? true;
    await setPurchasePaid(p.id, paid, q.zahlart ?? null);
    return `${p.number} als ${paid ? "bezahlt" : "offen"} markiert. (Wenn es einen Bankumsatz dazu gibt, besser auf /buchhaltung/bank zuordnen.)`;
  }
  const user = await actor(ctx.userId);
  if (q.aktion === "anlegen") {
    if (!q.lieferant || q.brutto == null) return "Für eine Ausgabe brauche ich mindestens Lieferant und Bruttobetrag.";
    const date = q.datum ?? todayYmd();
    const grossCents = Math.round(q.brutto * 100);
    const dup = await findDuplicatePurchase({ supplier: q.lieferant, docNo: q.rechnungsnummer ?? null, date, grossCents });
    if (dup) return `Diese Rechnung ist schon als ${dup.number} gebucht (${dup.supplier}, ${euro(dup.grossCents)}) – nicht doppelt angelegt. [öffnen](/buchhaltung/ausgaben/${dup.id})`;
    const p = await createPurchase(
      purchaseInput.parse({ supplier: q.lieferant, docNo: q.rechnungsnummer ?? null, date, dueDate: q.faellig ?? null, category: q.kategorie ?? "MATERIAL", grossCents, taxRate: q.ust_satz ?? 19, projectId: q.projektId ?? null, paid: q.bezahlt ?? false, payMethod: q.zahlart ?? null, note: q.notiz ?? "Von Jarvis angelegt (ohne Beleg)" }),
      user,
    );
    return `Ausgabe ${p.number} angelegt: ${p.supplier}, ${euro(p.grossCents)} brutto. Beleg fehlt noch – bitte auf der Seite hochladen: [öffnen](/buchhaltung/ausgaben/${p.id})`;
  }
  // aendern
  const cur = await db.purchaseDoc.findUnique({ where: { id: q.id ?? "" } });
  if (!cur) return "Ausgabe nicht gefunden.";
  if (cur.exportedAt) return `${cur.number} ist schon an den Steuerberater (DATEV) exportiert – bitte nicht mehr ändern. Bei einem Fehler mit dem Steuerberater klären.`;
  const changedAmount = q.brutto != null || q.ust_satz != null;
  const p = await updatePurchase(
    cur.id,
    purchaseInput.parse({
      supplier: q.lieferant ?? cur.supplier, docNo: q.rechnungsnummer ?? cur.docNo, date: q.datum ?? ymdOf(cur.date), dueDate: q.faellig ?? ymdOf(cur.dueDate), category: q.kategorie ?? cur.category,
      grossCents: q.brutto != null ? Math.round(q.brutto * 100) : cur.grossCents, taxCents: changedAmount ? null : cur.taxCents, taxRate: q.ust_satz ?? cur.taxRate,
      projectId: q.projektId ?? cur.projectId, paid: cur.status === "BEZAHLT", payMethod: cur.payMethod, note: q.notiz ?? cur.note,
    }),
  );
  return `Ausgabe ${p.number} geändert: ${p.supplier}, ${euro(p.grossCents)} brutto, ${PURCHASE_CATEGORIES[p.category as PurchaseCategory]} · [öffnen](/buchhaltung/ausgaben/${p.id})`;
}

/** Suche über alles, gefiltert nach den Bereichen des Nutzers */
async function search(s: string, areas: readonly Area[]) {
  const has = (a: Area) => areas.includes(a);
  const ci = { contains: s, mode: "insensitive" as const };
  const n = /^\d{3,9}$/.test(s) ? Number(s) : null;
  const [customers, docs, purchases, articles, projects, orders, suppliers, stock] = await Promise.all([
    has("buchhaltung") ? db.customer.findMany({ where: { archived: false, OR: [{ name: ci }, { email: ci }, { city: ci }, { contactName: ci }, ...(n ? [{ number: n }] : [])] }, take: 8 }) : [],
    has("buchhaltung") ? db.salesDoc.findMany({ where: { OR: [{ number: ci }, { title: ci }, { customer: { name: ci } }] }, include: { customer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    has("buchhaltung") ? db.purchaseDoc.findMany({ where: { OR: [{ supplier: ci }, { docNo: ci }, { number: ci }] }, orderBy: { date: "desc" }, take: 8 }) : [],
    has("buchhaltung") ? db.article.findMany({ where: { archived: false, OR: [{ name: ci }, { number: ci }] }, take: 6 }) : [],
    has("projekte") ? db.project.findMany({ where: { OR: [{ name: ci }, { address: ci }, { customer: ci }] }, take: 8 }) : [],
    has("auftraege") ? db.order.findMany({ where: { OR: [{ number: ci }, { title: ci }] }, take: 8 }) : [],
    has("einkauf") ? db.supplier.findMany({ where: { OR: [{ name: ci }, { city: ci }, { contactName: ci }] }, take: 6 }) : [],
    has("lager") ? db.stockItem.findMany({ where: { OR: [{ name: ci }, { articleNo: ci }] }, take: 6 }) : [],
  ]);
  const out: string[] = [];
  const sec = (title: string, lines: string[]) => lines.length && out.push(`${title}:\n${lines.join("\n")}`);
  sec("Kunden", customers.map((c) => `- ${customerLine(c)} · [öffnen](/buchhaltung/kunden/${c.id})`));
  sec("Angebote/Rechnungen/Gutschriften", docs.map((d) => `- ${d.kind} ${d.number ?? "Entwurf"} · ${d.customer?.name ?? "?"}${d.title ? ` · ${d.title}` : ""} · ${d.status} · id ${d.id} · [öffnen](/buchhaltung/beleg/${d.id})`));
  sec("Ausgaben", purchases.map(purchaseLine));
  sec("Artikel", articles.map((a) => `- ${a.number ? `${a.number} · ` : ""}${a.name} · ${Number(a.priceNet).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}/${a.unit} · id ${a.id}`));
  sec("Projekte", projects.map((p) => `- ${p.name} · ${p.status} · id ${p.id} · [öffnen](/projekte/${p.id})`));
  sec("Aufträge", orders.map((o) => `- ${o.number} · ${o.title} · ${o.status} · id ${o.id} · [öffnen](/auftraege/${o.id})`));
  sec("Lieferanten", suppliers.map((x) => `- ${x.name}${x.city ? ` · ${x.city}` : ""} · id ${x.id} · [öffnen](/lieferanten/${x.id})`));
  sec("Lager", stock.map((x) => `- ${x.name} · Bestand ${x.quantity.toLocaleString("de-DE")} ${x.unit} · id ${x.id} · [öffnen](/lager/${x.id})`));
  return out.length ? `Treffer für „${s}“:\n\n${out.join("\n\n")}` : `Nichts gefunden für „${s}“ (auch Mails mit mails, Dokumente mit dokumente_suchen, Altdaten mit altdaten durchsuchen).`;
}
