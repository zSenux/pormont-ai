// Digitale Personalakte – gemeinsam für Server und Browser: Dokument-Arten, Vertragsarten, was sensibel ist.

export const EMP_DOC_KINDS = ["ARBEITSVERTRAG", "FRAGEBOGEN", "AUSWEIS", "AUFENTHALT", "SOZIALVERSICHERUNG", "STEUER", "ZEUGNIS", "FUEHRERSCHEIN", "QUALIFIKATION", "UNTERWEISUNG", "ARBEITSMEDIZIN", "ERSTE_HILFE", "SONSTIGES"] as const;
export type EmpDocKind = (typeof EMP_DOC_KINDS)[number];

export const EMP_DOC_LABEL: Record<EmpDocKind, string> = {
  ARBEITSVERTRAG: "Vertrag / Vertragsänderung",
  FRAGEBOGEN: "Personalfragebogen (unterschrieben)",
  AUSWEIS: "Personalausweis / Reisepass",
  AUFENTHALT: "Aufenthaltstitel / Arbeitserlaubnis",
  SOZIALVERSICHERUNG: "Sozialversicherungsausweis / Krankenkasse",
  STEUER: "Steuer-ID / Lohnsteuer",
  ZEUGNIS: "Zeugnisse / Gesellenbrief",
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
export const EMP_SENSITIVE: readonly EmpDocKind[] = ["ARBEITSVERTRAG", "FRAGEBOGEN", "AUSWEIS", "AUFENTHALT", "SOZIALVERSICHERUNG", "STEUER", "ZEUGNIS", "ARBEITSMEDIZIN", "SONSTIGES"];
export const isSensitive = (kind: string) => EMP_SENSITIVE.includes(kind as EmpDocKind);

/** Vorschläge für die Bezeichnung (Metallbau) */
export const EMP_TITLE_HINTS: Partial<Record<EmpDocKind, string[]>> = {
  FUEHRERSCHEIN: ["Klasse B", "Klasse BE", "Klasse C1E", "Klasse CE", "Berufskraftfahrer Modul 95"],
  QUALIFIKATION: ["Schweißerprüfung EN ISO 9606-1 (135)", "Schweißerprüfung EN ISO 9606-1 (141)", "Staplerschein", "Kranschein", "Hubarbeitsbühne (IPAF/DGUV 308-008)", "Anschläger", "Elektrofachkraft für festgelegte Tätigkeiten", "SCC"],
  UNTERWEISUNG: ["Jahresunterweisung Arbeitsschutz", "PSA gegen Absturz", "Brandschutzhelfer", "Gefahrstoffe"],
  ARBEITSMEDIZIN: ["G41 Arbeiten mit Absturzgefahr", "G25 Fahr-, Steuer- und Überwachungstätigkeiten", "G39 Schweißrauche", "G20 Lärm"],
  ERSTE_HILFE: ["Ersthelfer-Ausbildung (DGUV)", "Erste-Hilfe-Fortbildung"],
  ARBEITSVERTRAG: ["Arbeitsvertrag", "Befristungsverlängerung", "Lohnerhöhung"],
  FRAGEBOGEN: ["Personalfragebogen"],
  AUSWEIS: ["Personalausweis", "Reisepass"],
  AUFENTHALT: ["Aufenthaltstitel", "Arbeitserlaubnis"],
  SOZIALVERSICHERUNG: ["Sozialversicherungsausweis", "Mitgliedsbescheinigung Krankenkasse"],
  STEUER: ["Steuer-ID (Schreiben Bundeszentralamt)"],
  ZEUGNIS: ["Gesellenbrief Metallbauer", "Meisterbrief", "Arbeitszeugnis"],
};

export const CONTRACT_TYPES = ["UNBEFRISTET", "BEFRISTET", "MINIJOB", "AUSBILDUNG", "WERKSTUDENT", "AUSHILFE"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = { UNBEFRISTET: "unbefristet", BEFRISTET: "befristet", MINIJOB: "Minijob", AUSBILDUNG: "Ausbildung", WERKSTUDENT: "Werkstudent", AUSHILFE: "Aushilfe" };

/** Relevantes Datum für die Ablaufwarnung: das frühere von „gültig bis“ und „nächste Kontrolle“ */
export function dueOf(d: { validUntil: Date | null; nextCheck: Date | null }) {
  const xs = [d.validUntil, d.nextCheck].filter(Boolean) as Date[];
  return xs.length ? new Date(Math.min(...xs.map((x) => x.getTime()))) : null;
}

/** Personalfragebogen wie beim Steuerbüro üblich (Lohnabrechnung) + Metallbau-Extras (Arbeitskleidung). Nur Admin. */
export type QField = { key: string; label: string; type?: "text" | "date" | "select"; options?: string[]; need?: boolean; wide?: boolean; hint?: string };
export const QUESTIONNAIRE: { title: string; fields: QField[] }[] = [
  {
    title: "Persönliche Angaben",
    fields: [
      { key: "nachname", label: "Nachname", need: true },
      { key: "vorname", label: "Vorname", need: true },
      { key: "geburtsname", label: "Geburtsname (falls abweichend)" },
      { key: "geburtsdatum", label: "Geburtsdatum", type: "date", need: true },
      { key: "geburtsort", label: "Geburtsort", need: true },
      { key: "geburtsland", label: "Geburtsland" },
      { key: "geschlecht", label: "Geschlecht", type: "select", options: ["männlich", "weiblich", "divers"], need: true },
      { key: "staatsangehoerigkeit", label: "Staatsangehörigkeit", need: true },
      { key: "familienstand", label: "Familienstand", type: "select", options: ["ledig", "verheiratet", "eingetragene Partnerschaft", "geschieden", "verwitwet", "getrennt lebend"] },
      { key: "anschrift", label: "Anschrift (Straße, PLZ, Ort)", need: true, wide: true },
      { key: "telefon", label: "Telefon / Handy" },
      { key: "email", label: "E-Mail privat" },
      { key: "schwerbehindert", label: "Schwerbehinderung", type: "select", options: ["nein", "ja"] },
      { key: "gdb", label: "Grad der Behinderung (falls ja)" },
    ],
  },
  {
    title: "Arbeitserlaubnis",
    fields: [
      { key: "aufenthalt", label: "Aufenthaltstitel nötig?", type: "select", options: ["nein (deutsch / EU / EWR / Schweiz)", "ja"], need: true },
      { key: "aufenthaltBis", label: "Aufenthaltstitel gültig bis", type: "date", hint: "Kopie unten als „Aufenthaltstitel“ ablegen – dann warnt Jarvis vor Ablauf" },
    ],
  },
  {
    title: "Bankverbindung",
    fields: [
      { key: "iban", label: "IBAN", need: true },
      { key: "bic", label: "BIC" },
      { key: "kontoinhaber", label: "Kontoinhaber (falls abweichend)" },
    ],
  },
  {
    title: "Steuer",
    fields: [
      { key: "steuerId", label: "Steuer-Identifikationsnummer (11 Ziffern)", need: true },
      { key: "steuerklasse", label: "Steuerklasse", type: "select", options: ["I", "II", "III", "IV", "IV mit Faktor", "V", "VI"], need: true },
      { key: "kinderfreibetraege", label: "Kinderfreibeträge" },
      { key: "konfession", label: "Konfession (Kirchensteuer)", type: "select", options: ["keine", "evangelisch", "römisch-katholisch", "altkatholisch", "sonstige"], need: true },
    ],
  },
  {
    title: "Sozialversicherung",
    fields: [
      { key: "svNummer", label: "Sozialversicherungs-/Rentenversicherungsnummer", need: true },
      { key: "krankenkasse", label: "Krankenkasse", need: true },
      { key: "kinder", label: "Kinder (Pflegeversicherung)", type: "select", options: ["keine", "ja – 1", "ja – 2", "ja – 3", "ja – 4", "ja – 5 oder mehr"] },
      { key: "weitereBeschaeftigung", label: "Weitere Beschäftigung / Minijob", type: "select", options: ["nein", "ja – Hauptbeschäftigung", "ja – Minijob", "ja – kurzfristig"], need: true },
      { key: "status", label: "Besonderer Status", type: "select", options: ["keiner", "Schüler/in", "Student/in", "Rentner/in", "Azubi"] },
    ],
  },
  {
    title: "Ausbildung",
    fields: [
      { key: "schulabschluss", label: "Höchster Schulabschluss", type: "select", options: ["ohne", "Hauptschule", "Mittlere Reife", "Abitur / Fachabitur"] },
      { key: "berufsausbildung", label: "Höchste Berufsausbildung", type: "select", options: ["ohne", "Anerkannte Berufsausbildung (Geselle)", "Meister / Techniker", "Bachelor", "Master / Diplom"] },
      { key: "beruf", label: "Erlernter Beruf" },
      { key: "fuehrerschein", label: "Führerscheinklassen" },
    ],
  },
  {
    title: "Arbeitskleidung & Notfall",
    fields: [
      { key: "kleidergroesse", label: "Jacke / Shirt" },
      { key: "hosengroesse", label: "Hose" },
      { key: "schuhgroesse", label: "Sicherheitsschuhe" },
      { key: "notfall", label: "Notfallkontakt (Name, Telefon)", need: true, wide: true },
    ],
  },
];
export const Q_FIELDS = QUESTIONNAIRE.flatMap((s) => s.fields);
export const Q_KEYS = Q_FIELDS.map((f) => f.key);

/** Wie viele Pflichtfelder sind ausgefüllt? */
export function questionnaireState(q: Record<string, string> | null | undefined) {
  const need = Q_FIELDS.filter((f) => f.need && !(f.key === "aufenthaltBis"));
  const filled = need.filter((f) => q?.[f.key]?.trim());
  return { filled: filled.length, total: need.length, missing: need.filter((f) => !q?.[f.key]?.trim()).map((f) => f.label) };
}

/** Unterlagen, die bei der Einstellung in die Akte gehören */
export const ONBOARDING: { kind: EmpDocKind; label: string; when?: "aufenthalt" }[] = [
  { kind: "ARBEITSVERTRAG", label: "Arbeitsvertrag (unterschrieben)" },
  { kind: "FRAGEBOGEN", label: "Personalfragebogen (unterschrieben)" },
  { kind: "AUSWEIS", label: "Personalausweis / Reisepass" },
  { kind: "AUFENTHALT", label: "Aufenthaltstitel / Arbeitserlaubnis", when: "aufenthalt" },
  { kind: "SOZIALVERSICHERUNG", label: "SV-Ausweis / Krankenkasse" },
  { kind: "STEUER", label: "Steuer-ID" },
  { kind: "FUEHRERSCHEIN", label: "Führerschein" },
  { kind: "ZEUGNIS", label: "Gesellenbrief / Zeugnisse" },
];

/** Mitarbeiter ohne Anmeldung (nur Personalakte, Stunden, Montage-Team) – Platzhalter statt Passwort */
export const NO_LOGIN_HASH = "ohne-zugang";
export const noLogin = (u: { passwordHash?: string | null; email?: string }) => u.passwordHash === NO_LOGIN_HASH || Boolean(u.email?.endsWith("@ohne-zugang.invalid"));
