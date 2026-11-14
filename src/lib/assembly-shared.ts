// Montage – Status und Vorlagen (auch im Browser nutzbar)
export const ASM_STATUS_LABEL = { GEPLANT: "Geplant", LAEUFT: "Läuft", ERLEDIGT: "Montiert – Abnahme offen", ABGENOMMEN: "Abgenommen", ABGESAGT: "Abgesagt" } as const;
export type AsmStatus = keyof typeof ASM_STATUS_LABEL;
export const ASM_STATUSES = Object.keys(ASM_STATUS_LABEL) as [AsmStatus, ...AsmStatus[]];
export const ASM_TONE: Record<AsmStatus, string> = {
  GEPLANT: "bg-sky-50 text-brand border-sky-200",
  LAEUFT: "bg-brand-soft text-brand border-brand/20",
  ERLEDIGT: "bg-amber-50 text-warn border-amber-200",
  ABGENOMMEN: "bg-emerald-50 text-ok border-emerald-200",
  ABGESAGT: "bg-mist text-steel border-line",
};
export const DEFAULT_CHECKLIST = [
  "Baustelle zugänglich, Absicherung eingerichtet",
  "Teile und Material vollständig (Lieferschein geprüft)",
  "Maße, Lot und Flucht geprüft",
  "Befestigung nach Statik/Herstellervorgabe (Dübel, Anker, Drehmoment)",
  "Schweiß- und Schraubverbindungen kontrolliert",
  "Korrosionsschutz / Beschichtung ausgebessert",
  "Fotos vorher und nachher gemacht",
  "Baustelle gereinigt, Abfall mitgenommen",
  "Kunde eingewiesen",
];
export type CheckItem = { text: string; done: boolean; by?: string | null; at?: string | null };
export type Defect = { text: string; fixed: boolean; by?: string | null; at?: string | null };
export const readChecklist = (raw: unknown): CheckItem[] => (Array.isArray(raw) ? raw.filter((x) => x && typeof x.text === "string").map((x) => ({ text: String(x.text), done: Boolean(x.done), by: x.by ?? null, at: x.at ?? null })) : []);
export const readDefects = (raw: unknown): Defect[] => (Array.isArray(raw) ? raw.filter((x) => x && typeof x.text === "string").map((x) => ({ text: String(x.text), fixed: Boolean(x.fixed), by: x.by ?? null, at: x.at ?? null })) : []);
