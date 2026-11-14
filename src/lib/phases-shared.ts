// Phasen und Bezeichnungen fürs Projektmanagement – ohne Server-Abhängigkeiten (auch im Browser nutzbar).

export const PHASES = [
  { key: "ANFRAGE", sort: 1, title: "Kundenanfrage" },
  { key: "ANGEBOT", sort: 2, title: "Angebotserstellung" },
  { key: "AUFTRAG", sort: 3, title: "Auftragserteilung" },
  { key: "PLANUNG", sort: 4, title: "Technische Planung" },
  { key: "KONSTRUKTION", sort: 5, title: "Konstruktion" },
  { key: "BESCHAFFUNG", sort: 6, title: "Materialbeschaffung" },
  { key: "FERTIGUNG", sort: 7, title: "Fertigung" },
  { key: "OBERFLAECHE", sort: 8, title: "Oberflächenbearbeitung" },
  { key: "MONTAGE", sort: 9, title: "Montage" },
  { key: "ABNAHME", sort: 10, title: "Abnahme" },
  { key: "RECHNUNG", sort: 11, title: "Rechnungsstellung" },
  { key: "ABSCHLUSS", sort: 12, title: "Projektabschluss" },
] as const;

export type PhaseKey = (typeof PHASES)[number]["key"];
export const PHASE_KEYS = PHASES.map((p) => p.key) as [PhaseKey, ...PhaseKey[]];

export const PHASE_STATUS_LABEL = { OFFEN: "Offen", LAEUFT: "Läuft", ERLEDIGT: "Erledigt", ENTFAELLT: "Entfällt" } as const;
export type PhaseStatus = keyof typeof PHASE_STATUS_LABEL;
export const PHASE_STATUSES = Object.keys(PHASE_STATUS_LABEL) as [PhaseStatus, ...PhaseStatus[]];

export const PRIORITY_LABEL = { NIEDRIG: "Niedrig", NORMAL: "Normal", HOCH: "Hoch", DRINGEND: "Dringend" } as const;
export type Priority = keyof typeof PRIORITY_LABEL;
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as [Priority, ...Priority[]];
export const PRIORITY_TONE: Record<Priority, string> = {
  NIEDRIG: "bg-mist text-steel border-line",
  NORMAL: "bg-white text-steel border-line",
  HOCH: "bg-amber-50 text-warn border-amber-200",
  DRINGEND: "bg-red-50 text-bad border-red-200",
};
