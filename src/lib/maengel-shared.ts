// Mängelmanagement – Konstanten ohne Server-Abhängigkeiten (auch im Browser nutzbar)

export const DEFECT_STATUS_LABEL = { OFFEN: "Offen", IN_ARBEIT: "In Arbeit", BEHOBEN: "Behoben – prüfen", ERLEDIGT: "Erledigt", ABGELEHNT: "Kein Mangel" } as const;
export type DefectStatus = keyof typeof DEFECT_STATUS_LABEL;
export const DEFECT_STATUSES = Object.keys(DEFECT_STATUS_LABEL) as [DefectStatus, ...DefectStatus[]];
export const DEFECT_OPEN: DefectStatus[] = ["OFFEN", "IN_ARBEIT", "BEHOBEN"];

export const DEFECT_TONE: Record<DefectStatus, string> = {
  OFFEN: "border-red-200 bg-red-50 text-bad",
  IN_ARBEIT: "border-amber-200 bg-amber-50 text-warn",
  BEHOBEN: "border-brand/20 bg-brand-soft text-brand",
  ERLEDIGT: "border-emerald-200 bg-emerald-50 text-ok",
  ABGELEHNT: "border-line bg-mist text-steel",
};

export const SEVERITY_LABEL = { GERING: "gering", MITTEL: "mittel", SCHWER: "schwer" } as const;
export type Severity = keyof typeof SEVERITY_LABEL;
export const SEVERITIES = Object.keys(SEVERITY_LABEL) as [Severity, ...Severity[]];
export const SEVERITY_TONE: Record<Severity, string> = { GERING: "text-steel", MITTEL: "text-warn", SCHWER: "text-bad font-semibold" };

export const SOURCE_LABEL = { INTERN: "Intern (eigene Prüfung)", KUNDE: "Vom Kunden gemeldet", ABNAHME: "Bei der Abnahme", GEWAEHRLEISTUNG: "Gewährleistung" } as const;
export type DefectSource = keyof typeof SOURCE_LABEL;
export const SOURCES = Object.keys(SOURCE_LABEL) as [DefectSource, ...DefectSource[]];

/** Standard-Frist je Schwere in Tagen */
export const SEVERITY_DAYS: Record<Severity, number> = { SCHWER: 3, MITTEL: 10, GERING: 21 };

/** Gewährleistung in Jahren (BGB Bauwerk 5 Jahre; VOB/B 4 Jahre) */
export const warrantyYears = () => {
  const n = Number(process.env.GEWAEHRLEISTUNG_JAHRE);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 5;
};
