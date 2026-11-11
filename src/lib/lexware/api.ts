import "server-only";
import { lexFile, lexGet, lexPost, permalink } from "./client";
import type { LexArticle, LexContact, LexCreated, LexPage, LexPayment, LexProfile, LexVoucher, LexVoucherListItem } from "./types";

// Fachliche Funktionen über der Lexware-API (lesen frei, schreiben nur über freigegebene Aktionen – siehe lib/jarvis/actions.ts)

export const VOUCHER_TYPES = {
  rechnungen: "invoice",
  angebote: "quotation",
  auftragsbestaetigungen: "orderconfirmation",
  gutschriften: "creditnote",
  lieferscheine: "deliverynote",
  eingangsrechnungen: "purchaseinvoice",
} as const;
export type VoucherKind = keyof typeof VOUCHER_TYPES;

/** Status je Belegart, die Lexware für „alle“ akzeptiert */
const ALL_STATUS: Record<string, string> = {
  invoice: "draft,open,overdue,paid,paidoff,voided",
  quotation: "draft,open,accepted,rejected",
  orderconfirmation: "draft,open",
  creditnote: "draft,open,paid,paidoff,voided",
  deliverynote: "draft,open",
  purchaseinvoice: "open,overdue,paid,paidoff,voided",
};

export const STATUS_DE: Record<string, string> = {
  draft: "Entwurf",
  open: "offen",
  overdue: "überfällig",
  paid: "bezahlt",
  paidoff: "ausgeglichen",
  voided: "storniert",
  accepted: "angenommen",
  rejected: "abgelehnt",
  transferred: "übertragen",
  sepadebit: "Lastschrift",
  unchecked: "ungeprüft",
};

export const profile = () => lexGet<LexProfile>("/v1/profile");

export async function searchContacts(q: { name?: string; email?: string; number?: number; page?: number }) {
  return lexGet<LexPage<LexContact>>("/v1/contacts", { name: q.name, email: q.email, number: q.number, page: q.page ?? 0, size: 25 });
}

export const getContact = (id: string) => lexGet<LexContact>(`/v1/contacts/${encodeURIComponent(id)}`);

export function contactName(c: LexContact) {
  return c.company?.name ?? [c.person?.firstName, c.person?.lastName].filter(Boolean).join(" ") ?? "(ohne Namen)";
}

export async function voucherList(opts: { type: string; status?: string; from?: string; to?: string; contactId?: string; page?: number; size?: number }) {
  return lexGet<LexPage<LexVoucherListItem>>("/v1/voucherlist", {
    voucherType: opts.type,
    voucherStatus: opts.status || ALL_STATUS[opts.type] || "open",
    voucherDateFrom: opts.from,
    voucherDateTo: opts.to,
    contactId: opts.contactId,
    archived: false,
    sort: "voucherDate,DESC",
    page: opts.page ?? 0,
    size: Math.min(opts.size ?? 50, 250),
  });
}

/** Alle Seiten (max. 10 × 250) – für Summen */
export async function voucherListAll(opts: Omit<Parameters<typeof voucherList>[0], "page" | "size">) {
  const out: LexVoucherListItem[] = [];
  for (let page = 0; page < 10; page++) {
    const p = await voucherList({ ...opts, page, size: 250 });
    out.push(...p.content);
    if (p.last || p.content.length === 0) break;
  }
  return out;
}

const PATH: Record<string, "invoices" | "quotations" | "order-confirmations" | "credit-notes"> = {
  invoice: "invoices",
  quotation: "quotations",
  orderconfirmation: "order-confirmations",
  creditnote: "credit-notes",
};

export function voucherPath(type: string) {
  return PATH[type] ?? null;
}

export async function getVoucher(type: string, id: string) {
  const p = voucherPath(type);
  if (!p) throw new Error("Für diese Belegart gibt es keine Detailansicht.");
  return lexGet<LexVoucher>(`/v1/${p}/${encodeURIComponent(id)}`);
}

export const getPayment = (id: string) => lexGet<LexPayment>(`/v1/payments/${encodeURIComponent(id)}`);

export function voucherPdf(type: string, id: string) {
  const p = voucherPath(type);
  if (!p) throw new Error("Für diese Belegart gibt es kein PDF.");
  return lexFile(`/v1/${p}/${encodeURIComponent(id)}/file`);
}

export function voucherLink(type: string, id: string) {
  const p = voucherPath(type);
  return p ? permalink(p, id) : null;
}

export async function listArticles(q: { type?: "PRODUCT" | "SERVICE"; articleNumber?: string; page?: number }) {
  return lexGet<LexPage<LexArticle>>("/v1/articles", { type: q.type, articleNumber: q.articleNumber, page: q.page ?? 0, size: 100 });
}

export const createContact = (body: unknown) => lexPost<LexCreated>("/v1/contacts", body);
export const createInvoice = (body: unknown, finalize: boolean) => lexPost<LexCreated>("/v1/invoices", body, finalize ? { finalize: true } : undefined);
export const createQuotation = (body: unknown, finalize: boolean) => lexPost<LexCreated>("/v1/quotations", body, finalize ? { finalize: true } : undefined);
