// Datum/Uhrzeit immer in Berliner Zeit anzeigen und rechnen
const TZ = "Europe/Berlin";

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function formatEuro(v: number | null | undefined) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v ?? 0);
}

/** Teile eines Zeitpunkts in Berliner Zeit */
export function berlinParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, weekday: p.weekday as string, ymd: `${p.year}-${p.month}-${p.day}` };
}

/** Berliner Wandzeit → UTC-Date (korrekt über Sommer-/Winterzeit) */
export function berlinDateTime(ymd: string, hm = "00:00") {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, min] = hm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const p = berlinParts(guess);
  const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess.getTime();
  return new Date(guess.getTime() - diff);
}

export function todayYmd() {
  return berlinParts().ymd;
}

export function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** „Mittwoch, 11. November 2026, 12:05 Uhr“ */
export function nowLine() {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()) + " Uhr";
}
