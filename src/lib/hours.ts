/** Minuten → „7,5 Std.“ */
export function formatHours(min: number) {
  const h = min / 60;
  return `${h.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Std.`;
}

/** „7,5“ / „7.5“ / „7:30“ / „45min“ → Minuten (max. 24 Std.) */
export function parseHours(s: string): number | null {
  const v = s.trim().toLowerCase();
  let m: number | null = null;
  const hhmm = v.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) m = +hhmm[1] * 60 + +hhmm[2];
  else if (/^\d+\s*min$/.test(v)) m = parseInt(v, 10);
  else if (/^\d+([.,]\d+)?\s*h?$/.test(v)) m = Math.round(parseFloat(v.replace(",", ".")) * 60);
  return m && m > 0 && m <= 24 * 60 ? m : null;
}
