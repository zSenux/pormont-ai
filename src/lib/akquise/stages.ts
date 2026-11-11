// Pipeline der Neukunden-Akquise (client-fähig)
export const STAGES = ["NEU", "KONTAKTIERT", "TERMIN", "ANGEBOT", "GEWONNEN", "VERLOREN"] as const;
export type StageKey = (typeof STAGES)[number];
export const STAGE_LABEL: Record<StageKey, string> = { NEU: "Neu", KONTAKTIERT: "Kontaktiert", TERMIN: "Termin", ANGEBOT: "Angebot", GEWONNEN: "Gewonnen", VERLOREN: "Verloren" };
export const STAGE_TONE: Record<StageKey, string> = {
  NEU: "border-line bg-mist text-steel",
  KONTAKTIERT: "border-sky-300 bg-sky-50 text-sky-800",
  TERMIN: "border-violet-300 bg-violet-50 text-violet-800",
  ANGEBOT: "border-amber-300 bg-amber-50 text-amber-800",
  GEWONNEN: "border-emerald-300 bg-emerald-50 text-emerald-800",
  VERLOREN: "border-red-300 bg-red-50 text-red-800",
};

/** Zielgruppen für Metallbau/Stahlbau/Industriemontage – Suchbegriff für Google */
export const TARGETS = [
  { query: "Bauunternehmen", why: "Geländer, Treppen, Stahlbau als Nachunternehmer" },
  { query: "Generalunternehmer Bau", why: "Metallbau-Gewerke im Paket" },
  { query: "Architekturbüro", why: "Planen Treppen, Geländer, Fassadenelemente" },
  { query: "Hausverwaltung", why: "Reparaturen, Geländer, Tore, Brandschutztüren" },
  { query: "Bauträger", why: "Balkone, Geländer, Treppen in Serie" },
  { query: "Ingenieurbüro Tragwerksplanung", why: "Empfehlen Stahlbauer" },
  { query: "Industriebetrieb", why: "Industriemontage, Bühnen, Rohrleitungen" },
  { query: "Logistikzentrum", why: "Regalanlagen, Bühnen, Anfahrschutz" },
  { query: "Facility Management", why: "Instandhaltung, Wartung" },
  { query: "Autohaus", why: "Tore, Überdachungen, Werkstatt-Metallbau" },
] as const;

export const ACTIVITY_LABEL: Record<string, string> = { NOTIZ: "Notiz", ANRUF: "Anruf", BRIEF: "Brief", MAIL: "E-Mail", TERMIN: "Termin", STUFE: "Stufe" };
