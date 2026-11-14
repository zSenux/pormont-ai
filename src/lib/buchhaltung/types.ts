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

export type DocData = {
  kind: DocKind;
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
