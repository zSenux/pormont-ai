import { z } from "zod";

// Bautagesbericht nach Vorlage des Auftraggebers (z. B. GOLDBECK Montage): Kopf, Witterung, 1. Arbeitseinsatz,
// 2. Geräteeinsatz, 3. Ausgeführte Arbeiten + Änderungen (Mann × Std.), 4. Besondere Vorkommnisse + Anordnungen.
// Ohne server-only – Formular und PDF nutzen dieselben Regeln.

export const CREW_ROLES = ["Richtmeister", "Monteur", "Kranfahrer", "Sonstige"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];
/** Zeilen im Abschnitt „1. Arbeitseinsatz“ (wie auf dem Formular) */
export const ROLE_LABEL: Record<CrewRole, string> = { Richtmeister: "Richtmeister", Monteur: "Monteure", Kranfahrer: "Kranfahrer", Sonstige: "übrige Beschäftigte" };

export const EQUIPMENT = [
  ["autokran", "Autokran"],
  ["tdk", "TDK"],
  ["telestapler", "Telestapler"],
  ["teleskopbuehne", "Teleskopbühne"],
  ["scherenbuehne", "Scherenbühne"],
  ["arbeitsbuehne", "Arbeitsbühne"],
] as const;
export type EquipmentKey = (typeof EQUIPMENT)[number][0];
export const EQUIPMENT_KEYS = EQUIPMENT.map(([k]) => k) as [EquipmentKey, ...EquipmentKey[]];

const text = (max: number) => z.string().trim().max(max).nullish();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Uhrzeit als HH:MM").nullish();
const num = (max: number) => z.number().min(0).max(max).nullish();

export const changeSchema = z.object({
  men: num(200),
  hours: num(24),
  crane: num(500),
  platforms: num(500),
  text: text(300),
});
export type ReportChange = z.infer<typeof changeSchema>;

export const reportSchema = z.object({
  /** Bericht-Nr. (laufend je Baustelle) */
  no: z.number().int().min(1).max(99999).nullish(),
  /** Ausführender Richtmeister */
  foreman: text(80),
  /** Gewerk, z. B. „Stahlbau / Treppen“ */
  trade: text(120),
  earlyFrom: hhmm,
  earlyTo: hhmm,
  lateFrom: hhmm,
  lateTo: hhmm,
  /** Temperatur in °C (leer = Höchstwert vom Wetterdienst) */
  temp: z.number().min(-40).max(55).nullish(),
  /** Sonne/Regen/Schnee von Hand – null = aus dem Wetter abgeleitet */
  sun: z.boolean().nullish(),
  rain: z.boolean().nullish(),
  snow: z.boolean().nullish(),
  /** Geräteeinsatz je Gerät als kurzer Text, z. B. „1 × 6 Std.“ */
  equipment: z.partialRecord(z.enum(EQUIPMENT_KEYS), z.string().trim().max(60)).nullish(),
  /** Änderungen / Zusatzleistungen: Mann × Std. */
  changes: z.array(changeSchema).max(12).nullish(),
  /** Anordnungen (des Auftraggebers / Fachbauleiters) */
  orders: text(4000),
});
export type Report = z.infer<typeof reportSchema>;

/** Gespeicherten Bericht lesen – fehlerhafte Felder fallen einzeln weg statt alles zu verwerfen */
export function readReport(raw: unknown): Report {
  if (!raw || typeof raw !== "object") return {};
  const all = reportSchema.safeParse(raw);
  if (all.success) return all.data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = reportSchema.shape[k as keyof Report];
    if (field?.safeParse(v).success) out[k] = v;
  }
  return out as Report;
}

/** Kopf je Projekt: Auftraggeber im Kopf, dessen Projekt-Nr., Standard-Gewerk, erste Bericht-Nr. */
export const headSchema = z.object({
  client: text(120),
  clientNo: text(60),
  trade: text(120),
  place: text(120),
  startNo: z.number().int().min(1).max(99999).nullish(),
});
export type DiaryHead = z.infer<typeof headSchema>;
export const readHead = (raw: unknown): DiaryHead => {
  const p = headSchema.safeParse(raw ?? {});
  return p.success ? p.data : {};
};

/** Ort aus der Projektadresse („Musterstr. 1, 68309 Mannheim“ → „Mannheim“) */
export const placeOf = (address: string | null | undefined) => address?.match(/\b\d{5}\s+(.+)$/)?.[1]?.trim() ?? address?.split(",").at(-1)?.trim() ?? null;

// ---------- Witterung ----------

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/** Sonne/Regen/Schnee + Temperatur: von Hand, sonst aus Wettercode und Messwerten */
export function weatherFlags(r: Report, w: { weatherCode: number | null; tempMax: number | null; rainMm: number | null; weather?: string | null }) {
  const code = w.weatherCode;
  // Wetter von Hand als Text („sonnig, 12 °C“) → aus den Wörtern ableiten
  const t = code === null ? (w.weather ?? "").toLowerCase() : "";
  const tempText = t.match(/(-?\d+)\s*°/g)?.at(-1);
  return {
    temp: r.temp ?? (w.tempMax !== null ? Math.round(w.tempMax) : tempText ? parseInt(tempText, 10) : null),
    sun: r.sun ?? (code !== null ? code <= 2 : /sonn|heiter|klar/.test(t)),
    rain: r.rain ?? ((code !== null && RAIN_CODES.has(code)) || (w.rainMm ?? 0) >= 0.5 || /regen|niesel|schauer|gewitter/.test(t)),
    snow: r.snow ?? (code !== null ? SNOW_CODES.has(code) : /schnee/.test(t)),
  };
}

// ---------- Arbeitseinsatz & Änderungen ----------

type Crew = { name: string; hours?: number | null; role?: string | null };
export const roleOf = (c: Crew): CrewRole => (CREW_ROLES.includes(c.role as CrewRole) ? (c.role as CrewRole) : "Monteur");

/** Personal nach Zeilen des Formulars: Anzahl, Namen, Stunden */
export function crewByRole(crew: Crew[]) {
  return CREW_ROLES.map((role) => {
    const list = crew.filter((c) => roleOf(c) === role);
    return { role, label: ROLE_LABEL[role], count: list.length, names: list.map((c) => c.name), hours: list.reduce((s, c) => s + (c.hours ?? 0), 0) };
  });
}

/** ∑ Stunden je Zeile = Mann × Std. (wie in der Vorlage) */
export const changeHours = (c: ReportChange) => (c.men ?? 0) * (c.hours ?? 0);
export function changeTotals(list: ReportChange[]) {
  return list.reduce<{ men: number; hours: number; crane: number; platforms: number }>((s, c) => ({ men: s.men + (c.men ?? 0), hours: s.hours + changeHours(c), crane: s.crane + (c.crane ?? 0), platforms: s.platforms + (c.platforms ?? 0) }), { men: 0, hours: 0, crane: 0, platforms: 0 });
}

export const shiftText = (from?: string | null, to?: string | null) => (from || to ? `${from ?? "…"} – ${to ?? "…"} Uhr` : null);

export const fmtNum = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
