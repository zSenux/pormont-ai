// Digitale Personalakte – gemeinsam für Server und Browser: Dokument-Arten, Vertragsarten, was sensibel ist.

export const EMP_DOC_KINDS = ["ARBEITSVERTRAG", "FUEHRERSCHEIN", "QUALIFIKATION", "UNTERWEISUNG", "ARBEITSMEDIZIN", "ERSTE_HILFE", "SONSTIGES"] as const;
export type EmpDocKind = (typeof EMP_DOC_KINDS)[number];

export const EMP_DOC_LABEL: Record<EmpDocKind, string> = {
  ARBEITSVERTRAG: "Vertrag / Vertragsänderung",
  FUEHRERSCHEIN: "Führerschein",
  QUALIFIKATION: "Qualifikation / Schein",
  UNTERWEISUNG: "Unterweisung",
  ARBEITSMEDIZIN: "Arbeitsmedizinische Vorsorge",
  ERSTE_HILFE: "Ersthelfer",
  SONSTIGES: "Sonstiges",
};

/**
 * Sensibel = nur Administratoren (Verträge, Gesundheit, Sonstiges).
 * Nicht sensibel = der Mitarbeiter sieht seine eigenen Einträge (ohne Datei), damit er weiß, was abläuft.
 */
export const EMP_SENSITIVE: readonly EmpDocKind[] = ["ARBEITSVERTRAG", "ARBEITSMEDIZIN", "SONSTIGES"];
export const isSensitive = (kind: string) => EMP_SENSITIVE.includes(kind as EmpDocKind);

/** Vorschläge für die Bezeichnung (Metallbau) */
export const EMP_TITLE_HINTS: Partial<Record<EmpDocKind, string[]>> = {
  FUEHRERSCHEIN: ["Klasse B", "Klasse BE", "Klasse C1E", "Klasse CE", "Berufskraftfahrer Modul 95"],
  QUALIFIKATION: ["Schweißerprüfung EN ISO 9606-1 (135)", "Schweißerprüfung EN ISO 9606-1 (141)", "Staplerschein", "Kranschein", "Hubarbeitsbühne (IPAF/DGUV 308-008)", "Anschläger", "Elektrofachkraft für festgelegte Tätigkeiten", "SCC"],
  UNTERWEISUNG: ["Jahresunterweisung Arbeitsschutz", "PSA gegen Absturz", "Brandschutzhelfer", "Gefahrstoffe"],
  ARBEITSMEDIZIN: ["G41 Arbeiten mit Absturzgefahr", "G25 Fahr-, Steuer- und Überwachungstätigkeiten", "G39 Schweißrauche", "G20 Lärm"],
  ERSTE_HILFE: ["Ersthelfer-Ausbildung (DGUV)", "Erste-Hilfe-Fortbildung"],
  ARBEITSVERTRAG: ["Arbeitsvertrag", "Befristungsverlängerung", "Lohnerhöhung"],
};

export const CONTRACT_TYPES = ["UNBEFRISTET", "BEFRISTET", "MINIJOB", "AUSBILDUNG", "WERKSTUDENT", "AUSHILFE"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = { UNBEFRISTET: "unbefristet", BEFRISTET: "befristet", MINIJOB: "Minijob", AUSBILDUNG: "Ausbildung", WERKSTUDENT: "Werkstudent", AUSHILFE: "Aushilfe" };

/** Relevantes Datum für die Ablaufwarnung: das frühere von „gültig bis“ und „nächste Kontrolle“ */
export function dueOf(d: { validUntil: Date | null; nextCheck: Date | null }) {
  const xs = [d.validUntil, d.nextCheck].filter(Boolean) as Date[];
  return xs.length ? new Date(Math.min(...xs.map((x) => x.getTime()))) : null;
}
