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

export const kmAmount = (km: number) => Math.round(km * KM_RATE);

export const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

/** „12,50“ / „12.50“ / „12“ → Cent */
export function parseEuro(s: string): number | null {
  const v = s.trim().replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const c = Math.round(parseFloat(v) * 100);
  return c > 0 && c <= 1_000_000 ? c : null;
}
