import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma, SalesDoc, Customer } from "@/generated/prisma/client";
import { addDaysYmd, berlinDateTime, berlinParts, todayYmd } from "@/lib/berlin";
import { bookConfig, missingForInvoices, type BookConfig } from "./config";
import { computeTotals, fmtEuroCents, linesSchema, readLines, type Line } from "./money";
import { buildCii } from "./xrechnung";
import { renderDocPdf } from "./pdf";
import { KIND_LABEL, type DocData, type DocKind, type Party } from "./types";

// Kern der Buchhaltung: Entwürfe anlegen/ändern, festschreiben (Nummer + Archiv-PDF/XML), stornieren,
// Angebot → Rechnung, Zahlungen. Regeln (GoBD):
// - Nur Entwürfe lassen sich ändern oder löschen (jede Änderung prüft status = ENTWURF in derselben Abfrage).
// - Festschreiben vergibt die Nummer aus NumberSeq in derselben Transaktion → fortlaufend, ohne Lücken, nie doppelt.
// - Festgeschriebene Belege werden nie mehr geändert; Korrektur nur per Storno-Gutschrift.
// - Jeder Schritt landet im Verlauf (SalesDocEvent).

export class BookError extends Error {}

export type Actor = { id: string; name: string };
type Tx = Prisma.TransactionClient;

export const STATUS_LABEL: Record<string, string> = { ENTWURF: "Entwurf", OFFEN: "offen", ANGENOMMEN: "angenommen", ABGELEHNT: "abgelehnt", BEZAHLT: "bezahlt", STORNIERT: "storniert" };
export const PREFIX: Record<DocKind, string> = { RECHNUNG: "RE", ANGEBOT: "AN", GUTSCHRIFT: "GS" };

export const ymdOf = (d: Date | null | undefined) => (d ? berlinParts(d).ymd : null);
const dayOf = (ymd: string) => berlinDateTime(ymd, "00:00");

/** Rechnung offen und Fälligkeit vorbei? */
export function isOverdue(d: Pick<SalesDoc, "kind" | "status" | "dueDate">) {
  return d.kind === "RECHNUNG" && d.status === "OFFEN" && !!d.dueDate && d.dueDate < dayOf(todayYmd());
}

export function statusText(d: Pick<SalesDoc, "kind" | "status" | "dueDate" | "paidCents" | "grossCents">) {
  if (isOverdue(d)) return d.paidCents ? "teilbezahlt, überfällig" : "überfällig";
  if (d.kind === "RECHNUNG" && d.status === "OFFEN" && d.paidCents > 0) return "teilbezahlt";
  return STATUS_LABEL[d.status];
}

export function greetingFor(c: Pick<Customer, "kind" | "salutation" | "lastName" | "contactName">) {
  const sal = (c.salutation ?? "").trim();
  const last = c.kind === "PERSON" ? c.lastName : c.contactName?.split(/\s+/).slice(-1)[0];
  if (last && /^herr/i.test(sal)) return `Sehr geehrter Herr ${last},`;
  if (last && /^frau/i.test(sal)) return `Sehr geehrte Frau ${last},`;
  return null;
}

export function partyOf(c: Customer): Party {
  return {
    name: c.name,
    contactName: c.kind === "FIRMA" ? c.contactName : null,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country: c.country || "DE",
    vatId: c.vatId,
    email: c.email,
    phone: c.phone,
    customerNo: c.number,
    buyerReference: c.buyerReference,
    greeting: greetingFor(c),
  };
}

const partySchema = z.object({
  name: z.string().default(""),
  contactName: z.string().nullish(),
  street: z.string().nullish(),
  zip: z.string().nullish(),
  city: z.string().nullish(),
  country: z.string().default("DE"),
  vatId: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  customerNo: z.number().nullish(),
  buyerReference: z.string().nullish(),
  greeting: z.string().nullish(),
});
export const readParty = (raw: unknown): Party => partySchema.catch({ name: "", country: "DE" }).parse(raw ?? {});

type DocWithRefs = SalesDoc & { customer?: Customer | null; project?: { name: string } | null };

/** Daten für PDF/XML aus einem Beleg. Entwürfe nehmen die aktuelle Kundenanschrift, festgeschriebene die eingefrorene. */
export async function docData(d: DocWithRefs, config?: BookConfig): Promise<DocData> {
  const cfg = config ?? (await bookConfig());
  const lines = readLines(d.lines);
  const buyer = d.status === "ENTWURF" && d.customer ? partyOf(d.customer) : readParty(d.address);
  let preceding: DocData["preceding"] = null;
  if (d.kind === "GUTSCHRIFT" && d.sourceId) {
    const src = await db.salesDoc.findUnique({ where: { id: d.sourceId }, select: { number: true, date: true } });
    if (src?.number) preceding = { number: src.number, date: ymdOf(src.date)! };
  }
  const project = d.project !== undefined ? d.project : d.projectId ? await db.project.findUnique({ where: { id: d.projectId }, select: { name: true } }) : null;
  return {
    kind: d.kind,
    number: d.number,
    date: ymdOf(d.date)!,
    serviceFrom: ymdOf(d.serviceFrom),
    serviceTo: ymdOf(d.serviceTo),
    dueDate: ymdOf(d.dueDate),
    title: d.title,
    intro: d.intro,
    outro: d.outro,
    reverseCharge: d.reverseCharge,
    lines,
    totals: computeTotals(lines, d.reverseCharge),
    buyer,
    preceding,
    projectName: project?.name ?? null,
    config: cfg,
  };
}

async function log(tx: Tx | typeof db, docId: string, text: string, user?: Actor | null) {
  await tx.salesDocEvent.create({ data: { docId, text, userName: user?.name ?? null } });
}

// ---------- Entwürfe ----------

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");

export const draftInput = z.object({
  customerId: z.string().max(40).nullish(),
  projectId: z.string().max(40).nullish(),
  title: z.string().trim().max(200).nullish(),
  intro: z.string().trim().max(4000).nullish(),
  outro: z.string().trim().max(4000).nullish(),
  date: ymd.optional(),
  serviceFrom: ymd.nullish(),
  serviceTo: ymd.nullish(),
  /** Angebot: gültig bis; Rechnung: wird beim Festschreiben aus dem Zahlungsziel berechnet */
  dueDate: ymd.nullish(),
  paymentDays: z.number().int().min(0).max(120).nullish(),
  reverseCharge: z.boolean().optional(),
  lines: linesSchema.optional(),
});
export type DraftInput = z.infer<typeof draftInput>;

async function checkRefs(i: DraftInput) {
  if (i.customerId && !(await db.customer.findUnique({ where: { id: i.customerId }, select: { id: true } }))) throw new BookError("Kunde nicht gefunden.");
  if (i.projectId && !(await db.project.findUnique({ where: { id: i.projectId }, select: { id: true } }))) throw new BookError("Projekt nicht gefunden.");
}

function draftData(i: DraftInput) {
  const lines = i.lines;
  const t = lines ? computeTotals(lines, i.reverseCharge ?? false) : null;
  return {
    ...(i.customerId !== undefined ? { customerId: i.customerId || null } : {}),
    ...(i.projectId !== undefined ? { projectId: i.projectId || null } : {}),
    ...(i.title !== undefined ? { title: i.title || null } : {}),
    ...(i.intro !== undefined ? { intro: i.intro || null } : {}),
    ...(i.outro !== undefined ? { outro: i.outro || null } : {}),
    ...(i.date ? { date: dayOf(i.date) } : {}),
    ...(i.serviceFrom !== undefined ? { serviceFrom: i.serviceFrom ? dayOf(i.serviceFrom) : null } : {}),
    ...(i.serviceTo !== undefined ? { serviceTo: i.serviceTo ? dayOf(i.serviceTo) : null } : {}),
    ...(i.dueDate !== undefined ? { dueDate: i.dueDate ? dayOf(i.dueDate) : null } : {}),
    ...(i.paymentDays !== undefined ? { paymentDays: i.paymentDays ?? null } : {}),
    ...(i.reverseCharge !== undefined ? { reverseCharge: i.reverseCharge } : {}),
    ...(lines && t ? { lines: lines as object[], netCents: t.netCents, taxCents: t.taxCents, grossCents: t.grossCents } : {}),
  };
}

export async function createDraft(kind: DocKind, input: DraftInput, user: Actor, extra: { sourceId?: string | null } = {}) {
  const i = draftInput.parse(input);
  await checkRefs(i);
  const cfg = await bookConfig();
  const today = todayYmd();
  const lines = i.lines ?? [];
  const t = computeTotals(lines, i.reverseCharge ?? false);
  const doc = await db.salesDoc.create({
    data: {
      kind,
      ...draftData({ ...i, lines }),
      date: dayOf(i.date ?? today),
      intro: i.intro !== undefined ? i.intro || null : kind === "ANGEBOT" ? cfg.quoteIntro : kind === "RECHNUNG" ? cfg.invoiceIntro : null,
      outro: i.outro !== undefined ? i.outro || null : kind === "ANGEBOT" ? cfg.quoteOutro : kind === "RECHNUNG" ? cfg.invoiceOutro : null,
      dueDate: kind === "ANGEBOT" ? dayOf(i.dueDate ?? addDaysYmd(i.date ?? today, cfg.quoteDays)) : null,
      netCents: t.netCents,
      taxCents: t.taxCents,
      grossCents: t.grossCents,
      sourceId: extra.sourceId ?? null,
      createdById: user.id,
      createdBy: user.name,
    },
  });
  await log(db, doc.id, `${KIND_LABEL[kind]} als Entwurf angelegt`, user);
  return doc;
}

export async function updateDraft(id: string, input: DraftInput, user: Actor) {
  const i = draftInput.parse(input);
  await checkRefs(i);
  const cur = await db.salesDoc.findUnique({ where: { id }, select: { reverseCharge: true, lines: true, status: true } });
  if (!cur) throw new BookError("Beleg nicht gefunden.");
  if (cur.status !== "ENTWURF") throw new BookError("Festgeschriebene Belege können nicht mehr geändert werden. Korrektur nur per Storno.");
  // Summen immer aus Positionen + Steuerart berechnen
  const lines = i.lines ?? readLines(cur.lines);
  const data = draftData({ ...i, lines, reverseCharge: i.reverseCharge ?? cur.reverseCharge });
  const r = await db.salesDoc.updateMany({ where: { id, status: "ENTWURF" }, data });
  if (!r.count) throw new BookError("Festgeschriebene Belege können nicht mehr geändert werden.");
  void user;
}

export async function deleteDraft(id: string) {
  const r = await db.salesDoc.deleteMany({ where: { id, status: "ENTWURF" } });
  if (!r.count) throw new BookError("Nur Entwürfe können gelöscht werden.");
}

// ---------- Festschreiben ----------

/** Nächster Wert eines Nummernkreises (atomar, ohne Lücken wenn in derselben Transaktion wie das Speichern). Auch für andere Module, z. B. Key „AUFTRAG-2026“. */
export async function nextSequence(tx: Tx, key: string) {
  const rows = await tx.$queryRaw<{ value: number }[]>`INSERT INTO "NumberSeq" ("key", "value") VALUES (${key}, 1) ON CONFLICT ("key") DO UPDATE SET "value" = "NumberSeq"."value" + 1 RETURNING "value"`;
  return Number(rows[0]?.value ?? 1);
}

async function nextNumber(tx: Tx, kind: DocKind, year: number) {
  const n = await nextSequence(tx, `${kind}-${year}`);
  return `${PREFIX[kind]}-${year}-${String(n).padStart(4, "0")}`;
}

/** Nummernkreise für die Einstellungen (zuletzt vergebene Nummer je Art im Jahr) */
export async function numberState(year: number) {
  const rows = await db.numberSeq.findMany({ where: { key: { in: (["RECHNUNG", "ANGEBOT", "GUTSCHRIFT"] as const).map((k) => `${k}-${year}`) } } });
  const get = (k: DocKind) => rows.find((r) => r.key === `${k}-${year}`)?.value ?? 0;
  return { RECHNUNG: get("RECHNUNG"), ANGEBOT: get("ANGEBOT"), GUTSCHRIFT: get("GUTSCHRIFT") };
}

/** Nächste Nummer setzen (z. B. um an Lexware anzuschließen) – nur nach oben, nie zurück */
export async function setNextNumber(kind: DocKind, year: number, next: number) {
  const key = `${kind}-${year}`;
  const r = await db.$executeRaw`INSERT INTO "NumberSeq" ("key", "value") VALUES (${key}, ${next - 1}) ON CONFLICT ("key") DO UPDATE SET "value" = ${next - 1} WHERE "NumberSeq"."value" < ${next - 1}`;
  if (!r) throw new BookError("Die Nummer darf nur erhöht werden – diese oder eine höhere Nummer ist schon vergeben.");
}

async function finalizeInTx(tx: Tx, id: string, user: Actor, cfg: BookConfig) {
  const d = await tx.salesDoc.findUnique({ where: { id }, include: { customer: true, project: { select: { name: true } } } });
  if (!d) throw new BookError("Beleg nicht gefunden.");
  if (d.status !== "ENTWURF") throw new BookError("Dieser Beleg ist schon festgeschrieben.");
  const lines = readLines(d.lines);
  if (!lines.length) throw new BookError("Der Beleg hat noch keine Positionen.");
  if (!d.customer) throw new BookError("Bitte zuerst einen Kunden auswählen.");
  if (!d.customer.street || !d.customer.zip || !d.customer.city) throw new BookError(`Beim Kunden ${d.customer.name} fehlt die vollständige Anschrift (Straße, PLZ, Ort).`);
  if (d.kind !== "ANGEBOT") {
    const missing = missingForInvoices(cfg);
    if (missing.length) throw new BookError(`Für Rechnungen fehlt noch: ${missing.join(", ")} – bitte unter Buchhaltung → Einstellungen eintragen.`);
    if (d.reverseCharge && !d.customer.vatId) throw new BookError("Für § 13b (Steuerschuldnerschaft des Leistungsempfängers) braucht der Kunde eine USt-IdNr.");
    const t = computeTotals(lines, d.reverseCharge);
    if (t.grossCents <= 0) throw new BookError("Der Rechnungsbetrag muss größer als 0 sein.");
  }

  const dateYmd = ymdOf(d.date)!;
  const days = d.paymentDays ?? d.customer.paymentDays ?? cfg.paymentDays;
  const dueDate = d.kind === "RECHNUNG" ? dayOf(addDaysYmd(dateYmd, days)) : d.kind === "ANGEBOT" ? (d.dueDate ?? dayOf(addDaysYmd(dateYmd, cfg.quoteDays))) : null;
  const number = await nextNumber(tx, d.kind, Number(dateYmd.slice(0, 4)));
  const address = partyOf(d.customer);
  const t = computeTotals(lines, d.reverseCharge);

  const frozen = { ...d, number, status: "OFFEN" as const, address: address as object, dueDate, serviceFrom: d.kind === "ANGEBOT" ? d.serviceFrom : (d.serviceFrom ?? d.date) };
  const data = await docData({ ...frozen, customer: d.customer }, cfg);
  data.buyer = address;
  const xml = d.kind === "ANGEBOT" ? null : buildCii(data, "zugferd");
  const pdf = Buffer.from(await renderDocPdf(data, xml));
  await tx.salesDoc.update({
    where: { id },
    data: {
      number,
      status: "OFFEN",
      address: address as object,
      dueDate,
      serviceFrom: frozen.serviceFrom,
      netCents: t.netCents,
      taxCents: t.taxCents,
      grossCents: t.grossCents,
      finalizedAt: new Date(),
      finalizedBy: user.name,
      pdf,
      xml,
      sha256: createHash("sha256").update(pdf).digest("hex"),
    },
  });
  await log(tx, id, `Festgeschrieben als ${KIND_LABEL[d.kind]} ${number} (${fmtEuroCents(t.grossCents)} brutto)`, user);
  return { number, kind: d.kind };
}

/** Entwurf festschreiben: Nummer vergeben, PDF (mit E-Rechnung) und XML archivieren. Danach unveränderlich. */
export async function finalizeDoc(id: string, user: Actor) {
  const cfg = await bookConfig();
  return db.$transaction((tx) => finalizeInTx(tx, id, user, cfg), { timeout: 30_000 });
}

// ---------- Storno, Angebot → Rechnung, Kopie ----------

/** Rechnung stornieren: Storno-Gutschrift mit denselben Positionen (festgeschrieben), Rechnung → STORNIERT */
export async function cancelInvoice(id: string, user: Actor) {
  const cfg = await bookConfig();
  return db.$transaction(
    async (tx) => {
      const inv = await tx.salesDoc.findUnique({ where: { id } });
      if (!inv || inv.kind !== "RECHNUNG") throw new BookError("Rechnung nicht gefunden.");
      if (inv.status === "STORNIERT") throw new BookError("Diese Rechnung ist schon storniert.");
      if (inv.status === "ENTWURF") throw new BookError("Einen Entwurf kannst du einfach löschen.");
      if (!inv.customerId) throw new BookError("Zur Rechnung gehört kein Kunde mehr – Storno nicht möglich.");
      const claim = await tx.salesDoc.updateMany({ where: { id, status: { in: ["OFFEN", "BEZAHLT"] } }, data: { status: "STORNIERT" } });
      if (!claim.count) throw new BookError("Diese Rechnung kann nicht storniert werden.");
      const lines = readLines(inv.lines);
      const t = computeTotals(lines, inv.reverseCharge);
      const gs = await tx.salesDoc.create({
        data: {
          kind: "GUTSCHRIFT",
          customerId: inv.customerId,
          projectId: inv.projectId,
          title: `Storno zu Rechnung ${inv.number}`,
          outro: null,
          intro: null,
          date: dayOf(todayYmd()),
          serviceFrom: inv.serviceFrom,
          serviceTo: inv.serviceTo,
          reverseCharge: inv.reverseCharge,
          lines: lines as object[],
          netCents: t.netCents,
          taxCents: t.taxCents,
          grossCents: t.grossCents,
          sourceId: inv.id,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      const r = await finalizeInTx(tx, gs.id, user, cfg);
      await log(tx, inv.id, `Storniert durch Gutschrift ${r.number}${inv.paidCents ? ` – Achtung: ${fmtEuroCents(inv.paidCents)} waren schon bezahlt (ggf. erstatten)` : ""}`, user);
      return { creditId: gs.id, number: r.number };
    },
    { timeout: 30_000 },
  );
}

/** Neuer Entwurf aus einem bestehenden Beleg (z. B. Angebot → Rechnung, oder Kopie) */
export async function copyDoc(id: string, kind: DocKind, user: Actor) {
  const src = await db.salesDoc.findUnique({ where: { id } });
  if (!src) throw new BookError("Beleg nicht gefunden.");
  const lines = readLines(src.lines);
  const doc = await createDraft(
    kind,
    {
      customerId: src.customerId,
      projectId: src.projectId,
      title: src.title,
      serviceFrom: kind === "RECHNUNG" ? null : ymdOf(src.serviceFrom),
      serviceTo: kind === "RECHNUNG" ? null : ymdOf(src.serviceTo),
      reverseCharge: src.reverseCharge,
      lines,
      ...(kind === src.kind ? { intro: src.intro, outro: src.outro } : {}),
    },
    user,
    { sourceId: src.kind === "ANGEBOT" && kind === "RECHNUNG" ? src.id : null },
  );
  if (src.kind === "ANGEBOT" && kind === "RECHNUNG") {
    if (src.status === "OFFEN") await db.salesDoc.updateMany({ where: { id: src.id, status: "OFFEN" }, data: { status: "ANGENOMMEN" } });
    await log(db, src.id, `In Rechnung übernommen (Entwurf)`, user);
    await log(db, doc.id, `Aus Angebot ${src.number ?? "(Entwurf)"} übernommen`, user);
  } else await log(db, doc.id, `Kopie von ${KIND_LABEL[src.kind]} ${src.number ?? "(Entwurf)"}`, user);
  return doc;
}

export async function setQuoteStatus(id: string, status: "OFFEN" | "ANGENOMMEN" | "ABGELEHNT", user: Actor) {
  const r = await db.salesDoc.updateMany({ where: { id, kind: "ANGEBOT", status: { in: ["OFFEN", "ANGENOMMEN", "ABGELEHNT"] } }, data: { status } });
  if (!r.count) throw new BookError("Nur festgeschriebene Angebote können angenommen oder abgelehnt werden.");
  await log(db, id, `Angebot als „${STATUS_LABEL[status]}“ markiert`, user);
}

// ---------- Zahlungen ----------

export const PAYMENT_METHODS: Record<string, string> = { UEBERWEISUNG: "Überweisung", BAR: "Bar", LASTSCHRIFT: "Lastschrift", SONSTIGES: "Sonstiges" };

async function recalcPaid(tx: Tx, docId: string) {
  const sum = await tx.payment.aggregate({ where: { docId }, _sum: { amountCents: true } });
  const paid = sum._sum.amountCents ?? 0;
  const d = await tx.salesDoc.findUniqueOrThrow({ where: { id: docId }, select: { grossCents: true, status: true } });
  const status = d.status === "STORNIERT" ? "STORNIERT" : paid >= d.grossCents ? "BEZAHLT" : "OFFEN";
  await tx.salesDoc.update({ where: { id: docId }, data: { paidCents: paid, status } });
  return { paid, status };
}

export async function addPayment(docId: string, p: { day: string; amountCents: number; method?: string; note?: string | null }, user: Actor) {
  if (!Number.isInteger(p.amountCents) || p.amountCents === 0 || Math.abs(p.amountCents) > 1e10) throw new BookError("Betrag prüfen.");
  return db.$transaction(async (tx) => {
    const d = await tx.salesDoc.findUnique({ where: { id: docId } });
    if (!d || d.kind !== "RECHNUNG") throw new BookError("Zahlungen gibt es nur zu Rechnungen.");
    if (d.status !== "OFFEN" && d.status !== "BEZAHLT") throw new BookError("Zu diesem Beleg kann keine Zahlung erfasst werden.");
    await tx.payment.create({ data: { docId, day: dayOf(p.day), amountCents: p.amountCents, method: p.method && PAYMENT_METHODS[p.method] ? p.method : "UEBERWEISUNG", note: p.note || null, userName: user.name } });
    const r = await recalcPaid(tx, docId);
    await log(tx, docId, `Zahlung ${fmtEuroCents(p.amountCents)} vom ${p.day.split("-").reverse().join(".")} erfasst${r.status === "BEZAHLT" ? " – Rechnung ist bezahlt" : ` – offen ${fmtEuroCents(d.grossCents - r.paid)}`}`, user);
    return r;
  });
}

export async function deletePayment(paymentId: string, user: Actor) {
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new BookError("Zahlung nicht gefunden.");
    await tx.payment.delete({ where: { id: paymentId } });
    await recalcPaid(tx, p.docId);
    await log(tx, p.docId, `Zahlung ${fmtEuroCents(p.amountCents)} gelöscht`, user);
    return p.docId;
  });
}

// ---------- Kennzahlen ----------

/** Umsatz netto (Rechnungen minus Gutschriften, festgeschrieben, nicht Entwurf) im Zeitraum */
export async function revenue(from: string, to: string) {
  const where = (kind: "RECHNUNG" | "GUTSCHRIFT") => ({ kind, status: { not: "ENTWURF" as const }, date: { gte: dayOf(from), lte: dayOf(to) } });
  const [inv, cr] = await Promise.all([
    db.salesDoc.aggregate({ where: where("RECHNUNG"), _sum: { netCents: true, grossCents: true }, _count: true }),
    db.salesDoc.aggregate({ where: where("GUTSCHRIFT"), _sum: { netCents: true, grossCents: true } }),
  ]);
  return {
    count: inv._count,
    netCents: (inv._sum.netCents ?? 0) - (cr._sum.netCents ?? 0),
    grossCents: (inv._sum.grossCents ?? 0) - (cr._sum.grossCents ?? 0),
  };
}

export async function openInvoices() {
  const list = await db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN" }, orderBy: { dueDate: "asc" }, include: { customer: { select: { name: true } } } });
  const overdue = list.filter(isOverdue);
  const sum = (l: typeof list) => l.reduce((s, d) => s + d.grossCents - d.paidCents, 0);
  return { list, overdue, openCents: sum(list), overdueCents: sum(overdue) };
}

export function customerName(d: { address: unknown; customer?: { name: string } | null }) {
  return d.customer?.name || readParty(d.address).name || "(ohne Kunde)";
}

export type { Line };
