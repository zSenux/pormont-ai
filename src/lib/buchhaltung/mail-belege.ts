import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { formatEuro } from "@/lib/berlin";
import { guessMime, IMAGE_TYPES, storeFile } from "@/lib/files";
import { mailAttachment, readMail } from "@/lib/mail/client";
import { analyzeReceipt, receiptData } from "@/lib/receipts";
import { createPurchase, purchaseFromReceipt, PURCHASE_CATEGORIES, type PurchaseCategory } from "./purchases";
import type { Actor } from "./docs";

// Eingangsrechnungen aus Mail-Anhängen als Ausgabe buchen: Anhang (PDF/Bild) → StoredFile „beleg“ → auslesen
// (wie „Beleg fotografieren“) → PurchaseDoc. Gebucht wird nur aus den ausgelesenen Daten in der DB, nie aus
// Modell-Angaben. Doppelte werden erkannt: gleiche Datei (SHA-256) oder gleiche Rechnungsnummer/Betrag beim selben Lieferanten.

export const MAIL_BELEG_MAX = 10;
const MAX_BYTES = 15 * 1024 * 1024;

export type MailBelegResult = {
  uid: string;
  file?: string;
  status: "gebucht" | "doppelt" | "unlesbar" | "kein_anhang" | "fehler";
  text: string;
  purchaseId?: string;
  number?: string;
};

// Läuft gerade schon (gleiche Datei zweimal gleichzeitig angestoßen)
const busy = new Set<string>();
// Auslesen läuft parallel, Doppelt-Prüfung + Buchen nacheinander (sonst zwei Mails mit derselben Rechnung gleichzeitig)
let bookLock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = bookLock.then(fn, fn);
  bookLock = run.catch(() => null);
  return run;
}

const RECHTSFORM = /\b(gmbh|mbh|ag|kg|ohg|gbr|ug|se|co|e\.?\s?k\.?|haftungsbeschränkt|deutschland|germany|und|&)\b/g;
/** Erstes kennzeichnendes Wort des Lieferanten („Würth GmbH & Co. KG“ → „würth“) */
export function supplierKey(s: string | null | undefined) {
  const t = (s ?? "").toLowerCase().replace(RECHTSFORM, " ").replace(/[^a-z0-9äöüß]+/g, " ").trim();
  return t.split(" ").find((w) => w.length >= 3) ?? t;
}
const normNo = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Gibt es diese Rechnung schon als Ausgabe? (gleiche Rechnungsnummer, oder Datum + Betrag beim selben Lieferanten) */
export async function findDuplicatePurchase(p: { supplier: string; docNo?: string | null; date: string; grossCents: number }) {
  const key = supplierKey(p.supplier);
  const no = normNo(p.docNo);
  const day = new Date(`${p.date}T12:00:00Z`);
  const from = new Date(day.getTime() - 400 * 864e5);
  const to = new Date(day.getTime() + 400 * 864e5);
  const cands = await db.purchaseDoc.findMany({
    where: { date: { gte: from, lte: to }, OR: [...(p.docNo ? [{ docNo: { contains: p.docNo.trim().slice(-6), mode: "insensitive" as const } }] : []), { grossCents: p.grossCents }] },
    select: { id: true, number: true, supplier: true, docNo: true, date: true, grossCents: true },
    take: 50,
  });
  return (
    cands.find((c) => {
      const sameSupplier = key.length >= 3 && supplierKey(c.supplier) === key;
      if (no.length >= 4 && normNo(c.docNo) === no) return sameSupplier || c.grossCents === p.grossCents;
      return sameSupplier && c.grossCents === p.grossCents && Math.abs(c.date.getTime() - day.getTime()) < 3 * 864e5;
    }) ?? null
  );
}

const euro = (c: number) => formatEuro(c / 100);

/** Alle Rechnungs-Anhänge einer Mail buchen. PDFs zuerst; Bilder nur, wenn die Mail kein PDF hat (sonst wären es Logos). */
export async function bookMailInvoices(uid: string, user: Actor, opts: { projectId?: string | null; category?: string | null; paid?: boolean | null; index?: number | null } = {}): Promise<MailBelegResult[]> {
  const m = await readMail(uid);
  const atts = m.attachments.map((a, i) => ({ ...a, i, mime: guessMime(a.filename) }));
  const pdfs = atts.filter((a) => a.mime === "application/pdf");
  let pick = opts.index != null ? atts.filter((a) => a.i === opts.index) : pdfs.length ? pdfs : atts.filter((a) => IMAGE_TYPES.includes(a.mime) && a.size > 30_000);
  pick = pick.slice(0, 5);
  if (!pick.length) {
    const xml = atts.some((a) => /\.xml$/i.test(a.filename));
    return [{ uid, status: "kein_anhang", text: `„${m.subject}“ (${m.from}): kein PDF- oder Bild-Anhang${xml ? " – nur eine XML-E-Rechnung, die bitte von Hand erfassen" : " – vermutlich nur ein Link zum Kundenportal; Rechnung dort herunterladen und hochladen"}.` }];
  }
  const out: MailBelegResult[] = [];
  for (const a of pick) {
    try {
      out.push(await bookOne(uid, m, a, user, opts));
    } catch (e) {
      console.error("[mail-beleg]", e);
      out.push({ uid, file: a.filename, status: "fehler", text: `${a.filename}: ${e instanceof Error ? e.message : "Fehler beim Buchen."}` });
    }
  }
  return out;
}

async function bookOne(uid: string, m: { from: string; fromAddress: string; subject: string }, a: { i: number; filename: string }, user: Actor, opts: { projectId?: string | null; category?: string | null; paid?: boolean | null }): Promise<MailBelegResult> {
  const base = { uid, file: a.filename };
  const att = await mailAttachment(uid, a.i);
  if (att.content.length > MAX_BYTES) return { ...base, status: "fehler", text: `${a.filename}: größer als 15 MB.` };
  const mime = guessMime(att.filename, att.contentType);
  if (mime !== "application/pdf" && !IMAGE_TYPES.includes(mime)) return { ...base, status: "kein_anhang", text: `${a.filename}: kein PDF/Bild.` };
  const sha = createHash("sha256").update(att.content).digest("hex");
  if (busy.has(sha)) return { ...base, status: "doppelt", text: `${a.filename}: wird gerade schon gebucht.` };
  busy.add(sha);
  try {
    // 1) Gleiche Datei schon da?
    const old = await db.storedFile.findFirst({ where: { kind: "beleg", sha256: sha }, select: { id: true, meta: true }, orderBy: { createdAt: "asc" } });
    if (old) {
      const used = await db.purchaseDoc.findFirst({ where: { fileId: old.id }, select: { id: true, number: true, supplier: true, grossCents: true } });
      if (used) return { ...base, status: "doppelt", purchaseId: used.id, number: used.number, text: `${a.filename}: schon gebucht als ${used.number} (${used.supplier}, ${euro(used.grossCents)}).` };
    }
    const file: { id: string; meta: unknown } = old ?? (await storeFile({ name: att.filename, mime, data: att.content, kind: "beleg", projectId: opts.projectId ?? null, uploadedBy: user.name }).then((f) => ({ id: f.id, meta: null })));
    // 2) Auslesen (einmal je Datei)
    if (!receiptData.safeParse(file.meta).success) {
      const r = await analyzeReceipt(file.id);
      if (!r) return { ...base, status: "unlesbar", text: `${a.filename}: konnte nicht ausgelesen werden (KI nicht eingerichtet oder Fehler). [Von Hand buchen](/buchhaltung/ausgaben/neu?foto=${file.id})` };
    }
    const pre = await purchaseFromReceipt(file.id);
    const meta = receiptData.parse((await db.storedFile.findUniqueOrThrow({ where: { id: file.id }, select: { meta: true } })).meta);
    if (!meta.lesbar || !pre.grossEuro || !pre.supplier) return { ...base, status: "unlesbar", text: `${a.filename}: keine lesbare Rechnung${meta.hinweis ? ` (${meta.hinweis})` : ""}. [Von Hand buchen](/buchhaltung/ausgaben/neu?foto=${file.id})` };
    const grossCents = Math.round(pre.grossEuro * 100);
    return await serial(async (): Promise<MailBelegResult> => {
    // 3) Gleiche Rechnung schon gebucht (z. B. vorher fotografiert oder zweite Mail)?
    const dup = await findDuplicatePurchase({ supplier: pre.supplier, docNo: pre.docNo || null, date: pre.date, grossCents });
    if (dup) return { ...base, status: "doppelt", purchaseId: dup.id, number: dup.number, text: `${a.filename}: ${pre.supplier}${pre.docNo ? ` Nr. ${pre.docNo}` : ""} ist schon als ${dup.number} gebucht (${euro(dup.grossCents)}) – nicht doppelt gebucht.` };
    // 4) Buchen
    const category = (opts.category && opts.category in PURCHASE_CATEGORIES ? opts.category : pre.category) as PurchaseCategory;
    const p = await createPurchase(
      {
        supplier: pre.supplier,
        docNo: pre.docNo || null,
        date: pre.date,
        dueDate: pre.dueDate,
        category,
        grossCents,
        taxCents: pre.taxEuro !== null ? Math.round(pre.taxEuro * 100) : null,
        taxRate: pre.taxRate,
        projectId: opts.projectId ?? pre.projectId,
        fileId: file.id,
        paid: opts.paid ?? pre.paid,
        payMethod: pre.payMethod,
        note: `Aus E-Mail von ${m.from}${m.fromAddress && m.fromAddress !== m.from ? ` <${m.fromAddress}>` : ""}: „${m.subject}“`.slice(0, 1000),
      },
      user,
    );
    return { ...base, status: "gebucht", purchaseId: p.id, number: p.number, text: `${a.filename}: gebucht als ${p.number} – ${p.supplier}${p.docNo ? ` Nr. ${p.docNo}` : ""}, ${euro(p.grossCents)} brutto, ${PURCHASE_CATEGORIES[category as PurchaseCategory]}${p.status === "BEZAHLT" ? ", bezahlt" : ""}.` };
    });
  } finally {
    busy.delete(sha);
  }
}
