// Rollen & Rechte (EPS): Funktion im Betrieb → freigegebene Bereiche.
// Administratoren und Mitarbeiter ohne Funktion sehen alles (so bleiben bestehende Konten unverändert).
// Immer erlaubt: Übersicht, Jarvis, Kalender, Aufgaben, Stunden, Spesen, Dokumente, Einstellungen.

export const AREAS = ["buchhaltung", "mail", "auftraege", "projekte", "fertigung", "montage", "lager", "einkauf", "akquise", "pc"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABEL: Record<Area, string> = {
  buchhaltung: "Buchhaltung (Kunden, Angebote, Rechnungen)",
  mail: "E-Mail-Postfach",
  auftraege: "Aufträge",
  projekte: "Projekte",
  fertigung: "Fertigung",
  montage: "Montage",
  lager: "Lager",
  einkauf: "Einkauf/Lieferanten",
  akquise: "Akquise",
  pc: "Computer-Steuerung",
};

export const FUNKTIONEN = ["GF", "PROJEKTLEITUNG", "VERTRIEB", "KONSTRUKTION", "EINKAUF", "FERTIGUNG", "MONTAGE", "BUCHHALTUNG", "LAGER"] as const;
export type Funktion = (typeof FUNKTIONEN)[number];

export const FUNKTION_LABEL: Record<Funktion, string> = {
  GF: "Geschäftsführung",
  PROJEKTLEITUNG: "Projektleitung",
  VERTRIEB: "Vertrieb",
  KONSTRUKTION: "Konstruktion",
  EINKAUF: "Einkauf",
  FERTIGUNG: "Fertigung/Werkstatt",
  MONTAGE: "Montage",
  BUCHHALTUNG: "Buchhaltung",
  LAGER: "Lager",
};

export const FUNKTION_AREAS: Record<Funktion, readonly Area[]> = {
  GF: AREAS,
  PROJEKTLEITUNG: ["buchhaltung", "mail", "auftraege", "projekte", "fertigung", "montage", "lager", "einkauf"],
  VERTRIEB: ["buchhaltung", "mail", "auftraege", "projekte", "akquise"],
  KONSTRUKTION: ["auftraege", "projekte", "fertigung", "montage"],
  EINKAUF: ["mail", "auftraege", "projekte", "lager", "einkauf"],
  FERTIGUNG: ["projekte", "fertigung", "lager"],
  MONTAGE: ["projekte", "montage", "lager"],
  BUCHHALTUNG: ["buchhaltung", "mail", "auftraege", "projekte", "einkauf"],
  LAGER: ["lager", "einkauf", "fertigung"],
};

export type RightsUser = { role: string; funktion?: string | null };

/** Bereiche, die dieser Nutzer sehen und benutzen darf */
export function areasOf(u: RightsUser): readonly Area[] {
  if (u.role === "ADMIN" || !u.funktion) return AREAS;
  return FUNKTION_AREAS[u.funktion as Funktion] ?? AREAS;
}

export const canArea = (u: RightsUser, area: Area) => areasOf(u).includes(area);

/** Seitenpfad → Bereich (für Navigation) */
export const PATH_AREA: Record<string, Area> = {
  "/buchhaltung": "buchhaltung",
  "/belege": "buchhaltung",
  "/mail": "mail",
  "/auftraege": "auftraege",
  "/projekte": "projekte",
  "/zeichnungen": "projekte",
  "/fertigung": "fertigung",
  "/montage": "montage",
  "/lager": "lager",
  "/lieferanten": "einkauf",
  "/akquise": "akquise",
  "/pc": "pc",
};

export function canPath(u: RightsUser, href: string) {
  const a = Object.entries(PATH_AREA).find(([p]) => href === p || href.startsWith(`${p}/`))?.[1];
  return !a || canArea(u, a);
}

/** Jarvis-Werkzeuge → Bereich (nicht aufgeführte Werkzeuge darf jeder benutzen) */
export const TOOL_AREA: Record<string, Area> = {
  kunden_suchen: "buchhaltung", kunde_details: "buchhaltung", kunde_anlegen: "buchhaltung", belege: "buchhaltung", beleg_details: "buchhaltung", umsatz: "buchhaltung", artikel: "buchhaltung",
  angebot_erstellen: "buchhaltung", rechnung_erstellen: "buchhaltung", beleg_aendern: "buchhaltung", angebot_in_rechnung: "buchhaltung", abschlaege: "buchhaltung", beleg_festschreiben: "buchhaltung",
  beleg_senden: "buchhaltung", zahlung_erfassen: "buchhaltung", mahnen: "buchhaltung", beleg_stornieren: "buchhaltung", kundenakte: "buchhaltung", altdaten: "buchhaltung", belegfotos: "buchhaltung", beleg_hochladen: "buchhaltung",
  mails: "mail", mail_lesen: "mail", mail_entwurf: "mail", mail_senden: "mail",
  lieferanten: "einkauf", katalog_suchen: "einkauf", preisanfrage: "einkauf",
  lager: "lager",
  nachkalkulation: "projekte", projekte: "projekte", projekt_notiz: "projekte", projekt_planung: "projekte", zeichnungen: "projekte",
  auftraege: "auftraege", fertigung: "fertigung", montage: "montage", akquise: "akquise", am_pc: "pc",
};

/** Freigabe-Karten (PendingAction) → Bereich, den der Freigebende braucht */
export const ACTION_AREA: Record<string, Area> = {
  beleg_festschreiben: "buchhaltung", beleg_senden: "buchhaltung", mahnung_senden: "buchhaltung", beleg_stornieren: "buchhaltung", kunde_anlegen: "buchhaltung",
  rechnung_erstellen: "buchhaltung", angebot_erstellen: "buchhaltung", beleg_hochladen: "buchhaltung", mail_senden: "mail", preisanfrage_senden: "einkauf",
};
