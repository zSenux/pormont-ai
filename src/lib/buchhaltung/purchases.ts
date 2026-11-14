import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, todayYmd } from "@/lib/berlin";
import { receiptData } from "@/lib/receipts";
import { BookError, nextSequence, ymdOf, type Actor } from "./docs";

// Ausgaben (Eingangsrechnungen, Kassenbons): ersetzen „Belege in Lexware“. Belegfoto → Ausgabe mit einem Klick,
// Daten aus dem Foto sind nur ein Vorschlag (Prüfen im Formular). Belegnummer E-JJJJ-0001 fortlaufend.

export const PURCHASE_CATEGORIES = {
  MATERIAL: "Material / Wareneinkauf",
  FREMDLEISTUNG: "Fremdleistung (z. B. Verzinkung, Pulverbeschichtung)",
  WERKZEUG: "Werkzeug / Kleingeräte",
  FAHRZEUG: "Fahrzeug (Reparatur, Wartung)",
  TANKEN: "Tanken",
  BUERO: "Büro / Porto / Telefon",
  BEWIRTUNG: "Bewirtung",
  MIETE: "Miete / Kran / Geräte",
  VERSICHERUNG: "Versicherung / Beiträge",
  SONSTIGES: "Sonstiges",
} as const;
export type PurchaseCategory = keyof typeof PURCHASE_CATEGORIES;
export const PAY_METHODS = { UEBERWEISUNG: "Überweisung", BAR: "Bar", KARTE: "EC-/Kreditkarte", LASTSCHRIFT: "Lastschrift" } as const;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");
const opt = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullish();

export const purchaseInput = z
  .object({
    supplier: z.string().trim().min(1, "Lieferant fehlt.").max(200),
    docNo: opt(100),
    date: ymd,
    dueDate: ymd.nullish(),
    category: z.enum(Object.keys(PURCHASE_CATEGORIES) as [PurchaseCategory, ...PurchaseCategory[]]).default("MATERIAL"),
    /** Bruttobetrag in Cent; Netto/USt. werden aus dem Satz berechnet, wenn nicht angegeben */
    grossCents: z.number().int().min(-100_000_000).max(1_000_000_000),
    taxCents: z.number().int().nullish(),
    taxRate: z.union([z.literal(19), z.literal(7), z.literal(0)]).default(19),
    projectId: z.string().max(40).nullish(),
    fileId: z.string().max(40).nullish(),
    paid: z.boolean().default(false),
    payMethod: z.enum(Object.keys(PAY_METHODS) as [keyof typeof PAY_METHODS, ...(keyof typeof PAY_METHODS)[]]).nullish(),
    note: opt(1000),
  })
  .refine((p) => p.grossCents !== 0, { message: "Betrag fehlt." });
export type PurchaseInput = z.infer<typeof purchaseInput>;

function amounts(p: PurchaseInput) {
  const tax = p.taxCents ?? Math.round((p.grossCents * p.taxRate) / (100 + p.taxRate));
  if (Math.abs(tax) > Math.abs(p.grossCents)) throw new BookError("Die Umsatzsteuer ist höher als der Bruttobetrag.");
  return { grossCents: p.grossCents, taxCents: tax, netCents: p.grossCents - tax };
}

function data(p: PurchaseInput) {
  return {
    supplier: p.supplier,
    docNo: p.docNo ?? null,
    date: berlinDateTime(p.date),
    dueDate: p.dueDate ? berlinDateTime(p.dueDate) : null,
    category: p.category,
    taxRate: p.taxRate,
    ...amounts(p),
    projectId: p.projectId || null,
    note: p.note ?? null,
    status: p.paid ? "BEZAHLT" : "OFFEN",
    payMethod: p.payMethod ?? null,
  };
}

async function checkRefs(p: PurchaseInput) {
  if (p.projectId && !(await db.project.findUnique({ where: { id: p.projectId }, select: { id: true } }))) throw new BookError("Projekt nicht gefunden.");
  if (p.fileId) {
    const f = await db.storedFile.findUnique({ where: { id: p.fileId }, select: { id: true } });
    if (!f) throw new BookError("Belegdatei nicht gefunden.");
    const used = await db.purchaseDoc.findFirst({ where: { fileId: p.fileId }, select: { number: true } });
    if (used) throw new BookError(`Dieser Beleg ist schon als Ausgabe ${used.number} gebucht.`);
  }
}

export async function createPurchase(input: PurchaseInput, user: Actor) {
  const p = purchaseInput.parse(input);
  await checkRefs(p);
  return db.$transaction(async (tx) => {
    const year = p.date.slice(0, 4);
    const n = await nextSequence(tx, `EINGANG-${year}`);
    const d = data(p);
    return tx.purchaseDoc.create({ data: { ...d, number: `E-${year}-${String(n).padStart(4, "0")}`, fileId: p.fileId || null, paidAt: p.paid ? berlinDateTime(p.date, "12:00") : null, createdBy: user.name } });
  });
}

export async function updatePurchase(id: string, input: PurchaseInput) {
  const p = purchaseInput.parse(input);
  const cur = await db.purchaseDoc.findUnique({ where: { id } });
  if (!cur) throw new BookError("Ausgabe nicht gefunden.");
  await checkRefs({ ...p, fileId: null });
  const d = data(p);
  return db.purchaseDoc.update({ where: { id }, data: { ...d, paidAt: p.paid ? (cur.paidAt ?? new Date()) : null } });
}

export async function setPurchasePaid(id: string, paid: boolean, method?: keyof typeof PAY_METHODS | null, day?: Date) {
  const r = await db.purchaseDoc.updateMany({ where: { id }, data: { status: paid ? "BEZAHLT" : "OFFEN", paidAt: paid ? (day ?? new Date()) : null, ...(method ? { payMethod: method } : {}) } });
  if (!r.count) throw new BookError("Ausgabe nicht gefunden.");
}

export async function deletePurchase(id: string) {
  const p = await db.purchaseDoc.findUnique({ where: { id }, select: { exportedAt: true } });
  if (!p) throw new BookError("Ausgabe nicht gefunden.");
  if (p.exportedAt) throw new BookError("Diese Ausgabe ist schon an den Steuerberater exportiert und kann nicht mehr gelöscht werden.");
  await db.bankTx.updateMany({ where: { purchaseId: id }, data: { purchaseId: null } });
  await db.purchaseDoc.delete({ where: { id } });
}

/** Vorschlag aus einem ausgelesenen Belegfoto (nur Vorschlag – der Mensch prüft im Formular) */
export async function purchaseFromReceipt(fileId: string) {
  const f = await db.storedFile.findUnique({ where: { id: fileId }, select: { id: true, kind: true, meta: true, projectId: true } });
  if (!f) throw new BookError("Belegfoto nicht gefunden.");
  const d = receiptData.safeParse(f.meta);
  const r = d.success ? d.data : null;
  const rate = r?.ustSatz === 7 ? 7 : r?.ustSatz === 0 ? 0 : 19;
  const cat = (r?.kategorie ?? "").toLowerCase();
  const category: PurchaseCategory = /tank|diesel|benzin/.test(cat) ? "TANKEN" : /bewirt|essen|restaurant/.test(cat) ? "BEWIRTUNG" : /werkzeug/.test(cat) ? "WERKZEUG" : /büro|buero|porto|telefon/.test(cat) ? "BUERO" : /fahrzeug|kfz|werkstatt/.test(cat) ? "FAHRZEUG" : "MATERIAL";
  const pay = (r?.zahlart ?? "").toLowerCase();
  return {
    supplier: r?.lieferant ?? "",
    docNo: r?.belegnummer ?? "",
    date: r?.datum ?? todayYmd(),
    category,
    grossEuro: r?.brutto ?? null,
    taxEuro: r?.ust ?? null,
    taxRate: rate as 19 | 7 | 0,
    projectId: f.projectId,
    paid: /bar|karte|ec|kredit/.test(pay),
    payMethod: /bar/.test(pay) ? "BAR" : /karte|ec|kredit/.test(pay) ? "KARTE" : null,
  };
}

/** Summen für die Übersicht */
export async function purchaseTotals(from: string, to: string) {
  const a = await db.purchaseDoc.aggregate({ where: { date: { gte: berlinDateTime(from), lte: berlinDateTime(to) } }, _sum: { netCents: true, taxCents: true, grossCents: true }, _count: true });
  const open = await db.purchaseDoc.aggregate({ where: { status: "OFFEN" }, _sum: { grossCents: true }, _count: true });
  return { count: a._count, netCents: a._sum.netCents ?? 0, taxCents: a._sum.taxCents ?? 0, grossCents: a._sum.grossCents ?? 0, openCount: open._count, openCents: open._sum.grossCents ?? 0 };
}

export const purchaseYmd = (d: { date: Date }) => ymdOf(d.date)!;

/** Fotografierte Belege, die weder als Ausgabe gebucht noch (früher) an Lexware übergeben wurden */
export async function unbookedReceiptsWhere() {
  const used = await db.purchaseDoc.findMany({ where: { fileId: { not: null } }, select: { fileId: true } });
  return { kind: "beleg", lexFileId: null, id: { notIn: used.map((u) => u.fileId!) } };
}
