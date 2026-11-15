// Spesen (Reisekosten) der Mitarbeiter – Pauschalen nach deutschem Steuerrecht (Richtwerte, Stand 2026).
// Werte bei einer Gesetzesänderung hier anpassen. Keine Steuerberatung – im Zweifel Steuerberater fragen.
// Datei ist client-fähig (keine Server-Importe).

/** Verpflegungsmehraufwand Inland (§ 9 Abs. 4a EStG) in Cent */
export const MEAL_RATES = { TAG8: 1400, REISE: 1400, TAG24: 2800 } as const;
export type MealDay = keyof typeof MEAL_RATES;
export const MEAL_LABEL: Record<MealDay, string> = {
  TAG8: "Eintägig, mehr als 8 Std. weg",
  REISE: "An- oder Abreisetag (mit Übernachtung)",
  TAG24: "Ganzer Tag unterwegs (24 Std.)",
};
/** Kürzung, wenn der Arbeitgeber/Kunde Mahlzeiten stellt: Frühstück 20 %, Mittag/Abend je 40 % der 24-Std.-Pauschale */
export const MEAL_CUT = { breakfast: 560, lunch: 1120, dinner: 1120 } as const;

/** Kilometerpauschale Dienstreise mit dem eigenen Auto in Cent je km */
export const KM_RATE = 30;

export const KINDS = ["VERPFLEGUNG", "FAHRT", "UEBERNACHTUNG", "AUSLAGE"] as const;
export type ExpenseKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<ExpenseKind, string> = {
  VERPFLEGUNG: "Verpflegung",
  FAHRT: "Fahrt (eigenes Auto)",
  UEBERNACHTUNG: "Übernachtung",
  AUSLAGE: "Auslage mit Beleg",
};

export const STATUS_LABEL = { EINGEREICHT: "Eingereicht", GENEHMIGT: "Genehmigt", ABGELEHNT: "Abgelehnt", AUSGEZAHLT: "Ausgezahlt" } as const;
export const STATUS_TONE = {
  EINGEREICHT: "border-amber-300 bg-amber-50 text-amber-800",
  GENEHMIGT: "border-emerald-300 bg-emerald-50 text-emerald-800",
  ABGELEHNT: "border-red-300 bg-red-50 text-red-800",
  AUSGEZAHLT: "border-brand/30 bg-brand-soft text-brand",
} as const;

/** Verpflegungspauschale nach Kürzung (nie unter 0) */
export function mealAmount(day: MealDay, meals: { breakfast?: boolean; lunch?: boolean; dinner?: boolean }) {
  let c: number = MEAL_RATES[day];
  if (meals.breakfast) c -= MEAL_CUT.breakfast;
  if (meals.lunch) c -= MEAL_CUT.lunch;
  if (meals.dinner) c -= MEAL_CUT.dinner;
  return Math.max(0, c);
}

export const kmAmount = (km: number, rate: number = KM_RATE) => Math.round(km * rate);

/** Übernachtung im Inland ohne Beleg: Pauschale 20 € steuerfrei (R 9.7 Abs. 3 LStR) */
export const NIGHT_FLAT = 2000;

// ---------- Spesensätze der Firma und Steuer-Aufteilung ----------
// Die Firma darf mehr zahlen als die steuerfreien Pauschalen. Verpflegung darüber hinaus kann bis zur Höhe der
// (ungekürzten) Pauschale mit 25 % pauschal versteuert werden (§ 40 Abs. 2 Satz 1 Nr. 4 EStG, zzgl. Soli/KiSt, trägt die Firma).
// Alles darüber – und mehr als 0,30 €/km – ist normaler Arbeitslohn (lohnsteuer- und sozialversicherungspflichtig).

/** Sätze, die die Firma zahlt (Cent). Standard = gesetzliche Pauschalen */
export type SpesenRates = { meal: Record<MealDay, number>; km: number; night: number };
export const DEFAULT_SPESEN_RATES: SpesenRates = { meal: { ...MEAL_RATES }, km: KM_RATE, night: NIGHT_FLAT };

/** Verpflegung zum Firmensatz; gestellte Mahlzeiten werden wie bei der Pauschale gekürzt */
export function mealAmountAt(rates: SpesenRates, day: MealDay, meals: { breakfast?: boolean; lunch?: boolean; dinner?: boolean }) {
  let c = rates.meal[day] ?? MEAL_RATES[day];
  if (meals.breakfast) c -= MEAL_CUT.breakfast;
  if (meals.lunch) c -= MEAL_CUT.lunch;
  if (meals.dinner) c -= MEAL_CUT.dinner;
  return Math.max(0, c);
}

export type TaxSplit = { free: number; flat25: number; taxable: number };
export const TAX_LABEL = { free: "steuerfrei", flat25: "pauschal versteuert (25 %)", taxable: "lohnsteuerpflichtig" } as const;

/** Aufteilung eines Spesen-Betrags: steuerfrei / pauschal 25 % / normal lohnsteuerpflichtig */
export function taxSplit(e: { kind: string; amountCents: number; mealDay?: string | null; breakfast?: boolean; lunch?: boolean; dinner?: boolean; km?: number | null; fileId?: string | null }): TaxSplit {
  const a = Math.max(0, e.amountCents);
  if (e.kind === "VERPFLEGUNG" && e.mealDay && e.mealDay in MEAL_RATES) {
    const day = e.mealDay as MealDay;
    const free = Math.min(a, mealAmount(day, e));
    const flat25 = Math.min(a - free, MEAL_RATES[day]);
    return { free, flat25, taxable: a - free - flat25 };
  }
  if (e.kind === "FAHRT") {
    const free = Math.min(a, kmAmount(e.km ?? 0));
    return { free, flat25: 0, taxable: a - free };
  }
  if (e.kind === "UEBERNACHTUNG" && !e.fileId) {
    const free = Math.min(a, NIGHT_FLAT);
    return { free, flat25: 0, taxable: a - free };
  }
  // Übernachtung mit Beleg und Auslagen mit Beleg: Auslagenersatz bzw. Reisekosten in tatsächlicher Höhe – steuerfrei
  return { free: a, flat25: 0, taxable: 0 };
}

export function sumSplit(rows: Parameters<typeof taxSplit>[0][]): TaxSplit {
  return rows.reduce<TaxSplit>((s, e) => {
    const t = taxSplit(e);
    return { free: s.free + t.free, flat25: s.flat25 + t.flat25, taxable: s.taxable + t.taxable };
  }, { free: 0, flat25: 0, taxable: 0 });
}

/** Pauschale Lohnsteuer 25 % + Solidaritätszuschlag 5,5 % darauf (Kirchensteuer je nach Bundesland zusätzlich) */
export const flatTaxOf = (flat25: number) => {
  const lst = Math.round(flat25 * 0.25);
  return { lst, soli: Math.round(lst * 0.055) };
};

export const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

/** „12,50“ / „12.50“ / „12“ → Cent */
export function parseEuro(s: string): number | null {
  const v = s.trim().replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const c = Math.round(parseFloat(v) * 100);
  return c > 0 && c <= 1_000_000 ? c : null;
}
