// Urlaub & Krank – gemeinsam für Server und Browser: Arten, Status, Feiertage Baden-Württemberg, Arbeitstage.

export const ABS_KINDS = ["URLAUB", "KRANK", "SONSTIGES"] as const;
export type AbsKind = (typeof ABS_KINDS)[number];
export const ABS_KIND_LABEL: Record<AbsKind, string> = { URLAUB: "Urlaub", KRANK: "Krank", SONSTIGES: "Sonstiges (Schule, Sonderurlaub …)" };
export const ABS_KIND_SHORT: Record<AbsKind, string> = { URLAUB: "Urlaub", KRANK: "Krank", SONSTIGES: "Abwesend" };
/** Farbe im Team-Plan */
export const ABS_KIND_CELL: Record<AbsKind, string> = { URLAUB: "bg-brand text-white", KRANK: "bg-bad text-white", SONSTIGES: "bg-steel text-white" };

export const ABS_STATUSES = ["BEANTRAGT", "GENEHMIGT", "ABGELEHNT", "STORNIERT"] as const;
export type AbsStatus = (typeof ABS_STATUSES)[number];
export const ABS_STATUS_LABEL: Record<AbsStatus, string> = { BEANTRAGT: "Beantragt", GENEHMIGT: "Genehmigt", ABGELEHNT: "Abgelehnt", STORNIERT: "Storniert" };
export const ABS_STATUS_TONE: Record<AbsStatus, string> = {
  BEANTRAGT: "border-warn/30 bg-amber-50 text-warn",
  GENEHMIGT: "border-ok/30 bg-green-50 text-ok",
  ABGELEHNT: "border-bad/30 bg-red-50 text-bad",
  STORNIERT: "border-line bg-mist text-steel",
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Ostersonntag (Gauß/Meeus) als UTC-Datum */
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const cache = new Map<number, Map<string, string>>();
/** Gesetzliche Feiertage in Baden-Württemberg (Mannheim) */
export function holidays(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const e = easter(y);
  const rel = (n: number) => ymdOf(new Date(e.getTime() + n * 86400_000));
  const m = new Map<string, string>([
    [`${y}-01-01`, "Neujahr"],
    [`${y}-01-06`, "Heilige Drei Könige"],
    [rel(-2), "Karfreitag"],
    [rel(1), "Ostermontag"],
    [`${y}-05-01`, "Tag der Arbeit"],
    [rel(39), "Christi Himmelfahrt"],
    [rel(50), "Pfingstmontag"],
    [rel(60), "Fronleichnam"],
    [`${y}-10-03`, "Tag der Deutschen Einheit"],
    [`${y}-11-01`, "Allerheiligen"],
    [`${y}-12-25`, "1. Weihnachtstag"],
    [`${y}-12-26`, "2. Weihnachtstag"],
  ]);
  cache.set(y, m);
  return m;
}

export const holidayName = (ymd: string) => holidays(Number(ymd.slice(0, 4))).get(ymd) ?? null;
export const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sonntag
export const isWorkday = (ymd: string) => ![0, 6].includes(weekdayOf(ymd)) && !holidayName(ymd);

/** Alle Tage von bis (inkl.) als JJJJ-MM-TT */
export function daysBetween(fromYmd: string, toYmd: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${fromYmd}T00:00:00Z`), end = Date.parse(`${toYmd}T00:00:00Z`); t <= end && out.length < 400; t += 86400_000) out.push(ymdOf(new Date(t)));
  return out;
}
export const workdaysBetween = (fromYmd: string, toYmd: string) => daysBetween(fromYmd, toYmd).filter(isWorkday);

export const fmtDays = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${n === 1 ? "Tag" : "Tage"}`;
