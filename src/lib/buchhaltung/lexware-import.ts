import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatEuro } from "@/lib/berlin";
import { lexGet, lexwareConfigured, LexwareError } from "@/lib/lexware/client";
import { getVoucher, voucherListAll, voucherPdf } from "@/lib/lexware/api";
import type { LexArticle, LexContact, LexPage, LexVoucherListItem } from "@/lib/lexware/types";
import { createCustomer, customerInput } from "./customers";
import { cents, computeTotals, type Line } from "./money";
import type { Party } from "./types";

// Umzug von Lexware Office in die Jarvis-Buchhaltung: Kunden, Artikel, offene Rechnungen (+ optional bezahlte
// Rechnungen/Gutschriften ab einem Datum für die Umsatz-Statistik) und offene Angebote.
// Läuft im Hintergrund (Lexware erlaubt nur 2 Anfragen/s); Fortschritt in JobState „lexware-import“.
// Übernommene Belege behalten ihre Lexware-Nummer und das Original-PDF und sind unveränderlich (Archiv).
// Ein erneuter Lauf legt nichts doppelt an (lexId) und gleicht den Zahlungsstand offener Rechnungen ab.

const KEY = "lexware-import";

export const importOptions = z.object({
  /** Bezahlte/stornierte Rechnungen und Gutschriften ab diesem Datum mit übernehmen (für die Umsatz-Statistik) */
  seit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  angebote: z.boolean().default(true),
});

export type ImportState = {
  status: "laeuft" | "fertig" | "fehler";
  step: string;
  kunden: number;
  artikel: number;
  rechnungen: number;
  angebote: number;
  abgeglichen: number;
  fehler: string[];
  startedAt: string;
  finishedAt?: string;
  by: string;
};

export async function importState(): Promise<ImportState | null> {
  const row = await db.jobState.findUnique({ where: { key: KEY } });
  try {
    return row ? (JSON.parse(row.value) as ImportState) : null;
  } catch {
    return null;
  }
}

async function save(s: ImportState) {
  const value = JSON.stringify(s);
  await db.jobState.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

/** Startet den Umzug im Hintergrund. Läuft schon einer (< 30 Min.), passiert nichts. */
export async function startLexwareImport(opts: z.input<typeof importOptions>, userName: string) {
  if (!lexwareConfigured()) throw new Error("Lexware ist nicht verbunden – der API-Schlüssel muss unter Einstellungen → Verbindungen stehen.");
  const o = importOptions.parse(opts);
  const cur = await importState();
  if (cur?.status === "laeuft" && Date.now() - new Date(cur.startedAt).getTime() < 30 * 60_000) throw new Error("Die Übernahme läuft schon.");
  const s: ImportState = { status: "laeuft", step: "Kunden", kunden: 0, artikel: 0, rechnungen: 0, angebote: 0, abgeglichen: 0, fehler: [], startedAt: new Date().toISOString(), by: userName };
  await save(s);
  void run(s, o).catch(async (e) => {
    s.status = "fehler";
    s.fehler.push(e instanceof LexwareError ? e.message : e instanceof Error ? e.message : "Unbekannter Fehler");
    s.finishedAt = new Date().toISOString();
    await save(s).catch(() => {});
    console.error("[lexware-import]", e);
  });
}

const first = (r?: Record<string, string[]>) => Object.values(r ?? {}).flat().find(Boolean) ?? null;

async function importContacts(s: ImportState) {
  for (let page = 0; page < 200; page++) {
    const p = await lexGet<LexPage<LexContact>>("/v1/contacts", { customer: true, page, size: 100 });
    for (const c of p.content) {
      try {
        const a = c.addresses?.billing?.[0];
        const cp = c.company?.contactPersons?.find((x) => x.primary) ?? c.company?.contactPersons?.[0];
        const input = customerInput.parse({
          kind: c.company ? "FIRMA" : "PERSON",
          company: c.company?.name ?? null,
          salutation: (c.company ? cp?.salutation : c.person?.salutation) || null,
          firstName: c.person?.firstName ?? null,
          lastName: c.person?.lastName ?? null,
          contactName: cp ? [cp.firstName, cp.lastName].filter(Boolean).join(" ") || null : null,
          email: (first(c.emailAddresses) ?? cp?.emailAddress ?? "").trim().toLowerCase() || null,
          phone: first(c.phoneNumbers) ?? cp?.phoneNumber ?? null,
          street: a?.street ?? null,
          zip: a?.zip ?? null,
          city: a?.city ?? null,
          country: a?.countryCode || "DE",
          vatId: c.company?.vatRegistrationId ?? null,
          notes: c.note ?? null,
        });
        const existing = await db.customer.findFirst({ where: { lexId: c.id }, select: { id: true } });
        if (existing) continue;
        await createCustomer(input, { number: c.roles.customer?.number ?? null, lexId: c.id });
        s.kunden++;
      } catch (e) {
        if (s.fehler.length < 30) s.fehler.push(`Kunde ${c.company?.name ?? c.person?.lastName ?? c.id}: ${e instanceof z.ZodError ? e.issues[0]?.message : e instanceof Error ? e.message : "Fehler"}`);
      }
    }
    await save(s);
    if (p.last || !p.content.length) break;
  }
}

async function importArticles(s: ImportState) {
  for (let page = 0; page < 100; page++) {
    const p = await lexGet<LexPage<LexArticle>>("/v1/articles", { page, size: 100 });
    for (const a of p.content) {
      if (await db.article.findFirst({ where: { lexId: a.id }, select: { id: true } })) continue;
      const rate = [19, 7, 0].includes(a.price?.taxRate ?? 19) ? (a.price?.taxRate ?? 19) : 19;
      const net = a.price?.netPrice ?? (a.price?.grossPrice !== undefined ? a.price.grossPrice / (1 + rate / 100) : 0);
      await db.article.create({ data: { lexId: a.id, number: a.articleNumber ?? null, name: a.title.slice(0, 300), description: a.description?.slice(0, 4000) ?? null, unit: a.unitName || "Stk", priceNet: Math.round(net * 10000) / 10000, taxRate: rate, kind: a.type === "PRODUCT" ? "MATERIAL" : "LEISTUNG" } });
      s.artikel++;
    }
    await save(s);
    if (p.last || !p.content.length) break;
  }
}

const STATUS: Record<string, "OFFEN" | "BEZAHLT" | "STORNIERT" | "ANGENOMMEN" | "ABGELEHNT"> = { open: "OFFEN", overdue: "OFFEN", paid: "BEZAHLT", paidoff: "BEZAHLT", voided: "STORNIERT", accepted: "ANGENOMMEN", rejected: "ABGELEHNT" };
const KIND = { invoice: "RECHNUNG", creditnote: "GUTSCHRIFT", quotation: "ANGEBOT" } as const;

async function pdfBytes(type: string, id: string) {
  try {
    const f = await voucherPdf(type, id);
    return f.body ? Buffer.from(await new Response(f.body).arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function importVoucher(item: LexVoucherListItem, s: ImportState) {
  const kind = KIND[item.voucherType as keyof typeof KIND];
  if (!kind) return;
  const status = STATUS[item.voucherStatus];
  if (!status) return; // Entwürfe nicht übernehmen
  const grossCents = cents(item.totalAmount ?? 0);
  const openCents = item.openAmount !== undefined && item.openAmount !== null ? cents(item.openAmount) : status === "BEZAHLT" ? 0 : grossCents;
  const paid = kind === "RECHNUNG" ? Math.max(0, grossCents - openCents) : 0;

  const existing = await db.salesDoc.findFirst({ where: { lexId: item.id }, select: { id: true, paidCents: true, status: true, grossCents: true } });
  if (existing) {
    // Abgleich: Zahlungsstand bzw. Storno aus Lexware nachziehen (nur bei übernommenen Belegen)
    if (kind === "RECHNUNG" && existing.status === "OFFEN" && paid > existing.paidCents) {
      await db.payment.create({ data: { docId: existing.id, day: new Date(), amountCents: paid - existing.paidCents, note: "Zahlungsabgleich aus Lexware" } });
      await db.salesDoc.update({ where: { id: existing.id }, data: { paidCents: paid, status: paid >= existing.grossCents ? "BEZAHLT" : "OFFEN" } });
      await db.salesDocEvent.create({ data: { docId: existing.id, text: `Zahlung ${formatEuro((paid - existing.paidCents) / 100)} aus Lexware abgeglichen` } });
      s.abgeglichen++;
    }
    if (status === "STORNIERT" && existing.status !== "STORNIERT") {
      await db.salesDoc.update({ where: { id: existing.id }, data: { status: "STORNIERT" } });
      await db.salesDocEvent.create({ data: { docId: existing.id, text: "In Lexware storniert – Status abgeglichen" } });
      s.abgeglichen++;
    }
    return;
  }

  const v = await getVoucher(item.voucherType, item.id);
  const lines: Line[] = (v.lineItems ?? [])
    .filter((l) => l.type !== "text" && l.quantity !== undefined)
    .map((l) => ({
      articleId: null,
      name: (l.name || "Position").slice(0, 300),
      description: l.description?.slice(0, 4000) ?? null,
      qty: l.quantity ?? 1,
      unit: (l.unitName || "Stk").slice(0, 30),
      price: l.unitPrice?.netAmount ?? (l.unitPrice?.grossAmount !== undefined ? l.unitPrice.grossAmount / (1 + (l.unitPrice.taxRatePercentage ?? 19) / 100) : 0),
      discount: Math.min(100, Math.max(0, l.discountPercentage ?? 0)),
      taxRate: ([19, 7, 0].includes(l.unitPrice?.taxRatePercentage ?? 19) ? (l.unitPrice?.taxRatePercentage ?? 19) : 19) as 19 | 7 | 0,
    }));
  const customer = v.address?.contactId ? await db.customer.findFirst({ where: { lexId: v.address.contactId } }) : null;
  const address: Party = {
    name: v.address?.name ?? customer?.name ?? item.contactName ?? "",
    street: v.address?.street ?? customer?.street ?? null,
    zip: v.address?.zip ?? customer?.zip ?? null,
    city: v.address?.city ?? customer?.city ?? null,
    country: v.address?.countryCode ?? customer?.country ?? "DE",
    email: customer?.email ?? null,
    vatId: customer?.vatId ?? null,
    customerNo: customer?.number ?? null,
    contactName: customer?.contactName ?? null,
  };
  const t = computeTotals(lines);
  const net = v.totalPrice?.totalNetAmount !== undefined ? cents(v.totalPrice.totalNetAmount) : t.netCents;
  const tax = v.totalPrice?.totalTaxAmount !== undefined ? cents(v.totalPrice.totalTaxAmount) : t.taxCents;
  const date = v.voucherDate ? new Date(v.voucherDate) : item.voucherDate ? new Date(item.voucherDate) : new Date();
  const ymd = berlinParts(date).ymd;
  let number = v.voucherNumber ?? item.voucherNumber ?? null;
  if (number && (await db.salesDoc.findFirst({ where: { kind, number }, select: { id: true } }))) number = `${number} (Lexware)`;
  const pdf = await pdfBytes(item.voucherType, item.id);
  const doc = await db.salesDoc.create({
    data: {
      kind,
      status,
      number,
      customerId: customer?.id ?? null,
      address: address as object,
      title: v.title ?? null,
      intro: v.introduction ?? null,
      outro: v.remark ?? null,
      date: berlinDateTime(ymd),
      dueDate: kind === "ANGEBOT" ? (v.expirationDate ? new Date(v.expirationDate) : null) : item.dueDate ? new Date(item.dueDate) : v.dueDate ? new Date(v.dueDate) : null,
      lines: lines as object[],
      netCents: net,
      taxCents: tax,
      grossCents: grossCents || net + tax,
      paidCents: paid,
      finalizedAt: date,
      finalizedBy: "Lexware",
      pdf,
      lexId: item.id,
      imported: true,
      createdBy: s.by,
    },
  });
  if (paid > 0) await db.payment.create({ data: { docId: doc.id, day: date, amountCents: paid, note: "Zahlungsstand aus Lexware übernommen" } });
  await db.salesDocEvent.create({ data: { docId: doc.id, text: `Aus Lexware übernommen (Status ${item.voucherStatus}${paid ? `, bezahlt ${formatEuro(paid / 100)}` : ""})${pdf ? "" : " – Original-PDF war nicht abrufbar"}`, userName: s.by } });
  if (kind === "ANGEBOT") s.angebote++;
  else s.rechnungen++;
}

async function run(s: ImportState, o: z.infer<typeof importOptions>) {
  await importContacts(s);
  s.step = "Artikel";
  await save(s);
  await importArticles(s);
  s.step = "Rechnungen";
  await save(s);
  const vouchers: LexVoucherListItem[] = [...(await voucherListAll({ type: "invoice", status: "open,overdue" }))];
  if (o.seit) {
    vouchers.push(...(await voucherListAll({ type: "invoice", status: "paid,paidoff,voided", from: o.seit })));
    vouchers.push(...(await voucherListAll({ type: "creditnote", status: "open,paid,paidoff,voided", from: o.seit }).catch(() => [])));
  }
  // Auch früher übernommene, noch offene Rechnungen abgleichen (inzwischen bezahlt?)
  const knownOpen = await db.salesDoc.findMany({ where: { imported: true, kind: "RECHNUNG", status: "OFFEN", lexId: { not: null } }, select: { lexId: true } });
  if (knownOpen.length) {
    const paidNow = await voucherListAll({ type: "invoice", status: "paid,paidoff,voided" });
    const want = new Set(knownOpen.map((k) => k.lexId));
    vouchers.push(...paidNow.filter((v) => want.has(v.id)));
  }
  const seen = new Set<string>();
  for (const v of vouchers) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    try {
      await importVoucher(v, s);
    } catch (e) {
      if (s.fehler.length < 30) s.fehler.push(`Beleg ${v.voucherNumber ?? v.id}: ${e instanceof Error ? e.message : "Fehler"}`);
    }
    if (seen.size % 5 === 0) await save(s);
  }
  if (o.angebote) {
    s.step = "Angebote";
    await save(s);
    for (const v of await voucherListAll({ type: "quotation", status: "open" })) {
      try {
        await importVoucher(v, s);
      } catch (e) {
        if (s.fehler.length < 30) s.fehler.push(`Angebot ${v.voucherNumber ?? v.id}: ${e instanceof Error ? e.message : "Fehler"}`);
      }
    }
  }
  s.status = "fertig";
  s.step = "Fertig";
  s.finishedAt = new Date().toISOString();
  await save(s);
}
