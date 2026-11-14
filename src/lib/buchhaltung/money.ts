import { z } from "zod";

// Positionen und Summen für Angebote, Rechnungen und Gutschriften.
// Rechenweg wie EN 16931 (E-Rechnung): Zeilen netto auf Cent runden, Umsatzsteuer je Steuersatz aus der Netto-Summe.

export const TAX_RATES = [19, 7, 0] as const;

export const lineSchema = z.object({
  /** Artikel aus dem Stamm (optional, nur Verweis) */
  articleId: z.string().max(40).nullish(),
  name: z.string().trim().min(1, "Jede Position braucht eine Bezeichnung.").max(300),
  description: z.string().trim().max(4000).nullish(),
  qty: z.number().min(-1_000_000).max(1_000_000),
  unit: z.string().trim().min(1).max(30).default("Stk"),
  /** Einzelpreis netto in Euro (bis 4 Nachkommastellen) */
  price: z.number().min(-10_000_000).max(10_000_000),
  /** Rabatt in Prozent */
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.union([z.literal(19), z.literal(7), z.literal(0)]).default(19),
});
export type Line = z.infer<typeof lineSchema>;

export const linesSchema = z.array(lineSchema).max(200);

/** Gespeicherte Positionen sicher lesen (alte/kaputte Einträge werden übersprungen) */
export function readLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    const p = lineSchema.safeParse(l);
    return p.success ? [p.data] : [];
  });
}

export const cents = (euro: number) => Math.round(euro * 100 + Number.EPSILON * Math.sign(euro));
export const euro = (c: number) => c / 100;

/** Zeilensumme netto in Cent */
export function lineNetCents(l: Line) {
  return Math.round(l.qty * l.price * (1 - l.discount / 100) * 100 + 1e-9);
}

export type TaxGroup = { rate: number; netCents: number; taxCents: number };

export function computeTotals(lines: Line[], reverseCharge = false) {
  const groups = new Map<number, TaxGroup>();
  let netCents = 0;
  for (const l of lines) {
    const n = lineNetCents(l);
    netCents += n;
    const rate = reverseCharge ? 0 : l.taxRate;
    const g = groups.get(rate) ?? { rate, netCents: 0, taxCents: 0 };
    g.netCents += n;
    groups.set(rate, g);
  }
  let taxCents = 0;
  for (const g of groups.values()) {
    g.taxCents = Math.round((g.netCents * g.rate) / 100);
    taxCents += g.taxCents;
  }
  const taxes = [...groups.values()].sort((a, b) => b.rate - a.rate);
  return { netCents, taxCents, grossCents: netCents + taxCents, taxes };
}

export function fmtEuroCents(c: number | null | undefined) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((c ?? 0) / 100);
}

export function fmtNum(v: number, max = 3) {
  return v.toLocaleString("de-DE", { maximumFractionDigits: max });
}

/** Einzelpreis: mindestens 2, höchstens 4 Nachkommastellen */
export function fmtPrice(v: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
}

/** Einheit → UN/ECE-Code (Rec. 20/21) für die E-Rechnung */
const UNIT_CODES: [RegExp, string][] = [
  [/^(stk|st|stück|stck|stueck|x)\.?$/i, "H87"],
  [/^(lfm|lfd\.?\s*m|m|mtr|meter)\.?$/i, "MTR"],
  [/^(m²|m2|qm)$/i, "MTK"],
  [/^(m³|m3|cbm)$/i, "MTQ"],
  [/^(kg|kilo)$/i, "KGM"],
  [/^(t|to|tonne[n]?)$/i, "TNE"],
  [/^(g)$/i, "GRM"],
  [/^(std|h|stunde[n]?|std\.)$/i, "HUR"],
  [/^(min|minute[n]?)$/i, "MIN"],
  [/^(tag|tage|tg)$/i, "DAY"],
  [/^(woche[n]?)$/i, "WEE"],
  [/^(monat|monate)$/i, "MON"],
  [/^(psch|pausch|pauschal|pauschale|ps|ls)\.?$/i, "LS"],
  [/^(satz|set)$/i, "SET"],
  [/^(paar)$/i, "PR"],
  [/^(l|liter)$/i, "LTR"],
  [/^(km)$/i, "KMT"],
  [/^(pak|pck|paket|pkg)$/i, "PK"],
  [/^(rolle[n]?)$/i, "RO"],
];
export function unitCode(unit: string) {
  const u = unit.trim();
  return UNIT_CODES.find(([re]) => re.test(u))?.[1] ?? "C62";
}

export const UNIT_SUGGESTIONS = ["Stk", "m", "lfm", "m²", "kg", "t", "Std.", "pauschal", "Satz", "Tag"];
