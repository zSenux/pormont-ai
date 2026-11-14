// Zeichnungen/CAD: Arten, Status, Index-Buchstaben (für Client und Server)

export const DRAWING_KINDS = ["WERKPLAN", "DETAIL", "STATIK", "MONTAGEPLAN", "AUFMASS", "KUNDE", "SONSTIGES"] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];
export const DRAWING_KIND_LABEL: Record<DrawingKind, string> = {
  WERKPLAN: "Werkplanung",
  DETAIL: "Detailzeichnung",
  STATIK: "Statik",
  MONTAGEPLAN: "Montageplan",
  AUFMASS: "Aufmaß",
  KUNDE: "Plan vom Kunden/Architekt",
  SONSTIGES: "Sonstiges",
};

export const DRAWING_STATUSES = ["ENTWURF", "PRUEFUNG", "FREIGEGEBEN", "UNGUELTIG"] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];
export const DRAWING_STATUS_LABEL: Record<DrawingStatus, string> = { ENTWURF: "In Bearbeitung", PRUEFUNG: "Zur Prüfung", FREIGEGEBEN: "Freigegeben", UNGUELTIG: "Ungültig" };
export const DRAWING_TONE: Record<DrawingStatus, string> = {
  ENTWURF: "border-line bg-mist text-steel",
  PRUEFUNG: "border-amber-200 bg-amber-50 text-warn",
  FREIGEGEBEN: "border-emerald-200 bg-emerald-50 text-ok",
  UNGUELTIG: "border-red-200 bg-red-50 text-bad",
};

/** Index 1 → A, 2 → B … 27 → AA */
export function indexLetter(v: number) {
  let s = "";
  for (let n = v; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s || "–";
}

/** Freigeben dürfen Administratoren, Geschäftsführung, Projektleitung (und Mitarbeiter ohne Funktion) */
export const canRelease = (u: { role: string; funktion?: string | null }) => u.role === "ADMIN" || !u.funktion || u.funktion === "GF" || u.funktion === "PROJEKTLEITUNG";
