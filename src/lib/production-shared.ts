// Fertigung – Status und Bezeichnungen (auch im Browser nutzbar)
export const PROD_STATUS = [
  { key: "OFFEN", label: "Noch nicht begonnen" },
  { key: "AV", label: "Arbeitsvorbereitung" },
  { key: "MATERIAL_FEHLT", label: "Material fehlt" },
  { key: "IN_FERTIGUNG", label: "In Fertigung" },
  { key: "QK", label: "In Qualitätskontrolle" },
  { key: "FERTIG", label: "Fertig" },
  { key: "MONTAGEBEREIT", label: "Zur Montage bereit" },
] as const;
export type ProdStatus = (typeof PROD_STATUS)[number]["key"];
export const PROD_STATUSES = PROD_STATUS.map((s) => s.key) as [ProdStatus, ...ProdStatus[]];
export const PROD_LABEL = Object.fromEntries(PROD_STATUS.map((s) => [s.key, s.label])) as Record<ProdStatus, string>;
export const PROD_TONE: Record<ProdStatus, string> = {
  OFFEN: "bg-mist text-steel border-line",
  AV: "bg-sky-50 text-brand border-sky-200",
  MATERIAL_FEHLT: "bg-red-50 text-bad border-red-200",
  IN_FERTIGUNG: "bg-brand-soft text-brand border-brand/20",
  QK: "bg-amber-50 text-warn border-amber-200",
  FERTIG: "bg-emerald-50 text-ok border-emerald-200",
  MONTAGEBEREIT: "bg-emerald-50 text-ok border-emerald-200",
};
/** Nächster üblicher Schritt auf der Fertigungskarte */
export const NEXT_STEP: Partial<Record<ProdStatus, ProdStatus>> = { OFFEN: "AV", AV: "IN_FERTIGUNG", MATERIAL_FEHLT: "IN_FERTIGUNG", IN_FERTIGUNG: "QK", QK: "FERTIG", FERTIG: "MONTAGEBEREIT" };
export const MACHINES = ["Bandsäge", "Kreissäge", "Bohrwerk", "Abkantbank", "Tafelschere", "Schweißplatz 1", "Schweißplatz 2", "Schleifen/Strahlen", "Montagetisch"];
