import type { Line, TaxGroup } from "./money";
import type { BookConfig } from "./config";

// Alles, was für PDF und E-Rechnung gebraucht wird – unabhängig von der Datenbank (für Vorschau und Festschreiben)

export type Party = {
  name: string;
  contactName?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country: string;
  vatId?: string | null;
  email?: string | null;
  phone?: string | null;
  customerNo?: number | null;
  buyerReference?: string | null;
  /** Briefanrede, z. B. „Sehr geehrter Herr Müller,“ */
  greeting?: string | null;
};

export type DocKind = "ANGEBOT" | "RECHNUNG" | "GUTSCHRIFT";

export type InvoiceType = "NORMAL" | "ABSCHLAG" | "SCHLUSS";

/** In einer Schlussrechnung abgezogene Abschlagsrechnung (Beträge beim Festschreiben eingefroren) */
export type Deduction = { id: string; number: string; date: string; netCents: number; taxCents: number; grossCents: number };

export type DocData = {
  kind: DocKind;
  /** Rechnungen: normal, Abschlag oder Schluss */
  invoiceType: InvoiceType;
  /** Schlussrechnung: abgezogene Abschläge */
  deductions: Deduction[];
  /** null = Entwurf (Vorschau mit Wasserzeichen) */
  number: string | null;
  /** JJJJ-MM-TT */
  date: string;
  serviceFrom?: string | null;
  serviceTo?: string | null;
  /** Rechnung: fällig am; Angebot: gültig bis */
  dueDate?: string | null;
  title?: string | null;
  intro?: string | null;
  outro?: string | null;
  reverseCharge: boolean;
  lines: Line[];
  totals: { netCents: number; taxCents: number; grossCents: number; taxes: TaxGroup[] };
  buyer: Party;
  /** Gutschrift: stornierte Rechnung */
  preceding?: { number: string; date: string } | null;
  projectName?: string | null;
  config: BookConfig;
};

export const KIND_LABEL: Record<DocKind, string> = { ANGEBOT: "Angebot", RECHNUNG: "Rechnung", GUTSCHRIFT: "Gutschrift" };

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = { NORMAL: "Rechnung", ABSCHLAG: "Abschlagsrechnung", SCHLUSS: "Schlussrechnung" };

/** Bezeichnung des Belegs, z. B. „Abschlagsrechnung“ */
export function docLabel(d: { kind: DocKind; invoiceType?: string | null }) {
  return d.kind === "RECHNUNG" ? (INVOICE_TYPE_LABEL[(d.invoiceType ?? "NORMAL") as InvoiceType] ?? "Rechnung") : KIND_LABEL[d.kind];
}

/** Summe der Abschläge */
export const sumDeductions = (l: Deduction[]) => l.reduce((s, x) => ({ netCents: s.netCents + x.netCents, taxCents: s.taxCents + x.taxCents, grossCents: s.grossCents + x.grossCents }), { netCents: 0, taxCents: 0, grossCents: 0 });
