// Nachunternehmer – gemeinsam für Server und Browser: Nachweis-Arten, Vertragsstatus, Ampel, Ablauf.

export const NU_DOC_KINDS = ["FREISTELLUNG_48B", "UNBEDENKLICHKEIT_FA", "UNBEDENKLICHKEIT_KK", "BG", "SOKA", "HAFTPFLICHT", "MINDESTLOHN", "GEWERBE", "SONSTIGES"] as const;
export type NuDocKind = (typeof NU_DOC_KINDS)[number];

export const NU_DOC_LABEL: Record<NuDocKind, string> = {
  FREISTELLUNG_48B: "Freistellungsbescheinigung § 48b EStG",
  UNBEDENKLICHKEIT_FA: "Unbedenklichkeitsbescheinigung Finanzamt",
  UNBEDENKLICHKEIT_KK: "Unbedenklichkeitsbescheinigung Krankenkasse",
  BG: "Unbedenklichkeitsbescheinigung Berufsgenossenschaft",
  SOKA: "Bescheinigung SOKA-BAU",
  HAFTPFLICHT: "Betriebshaftpflicht-Versicherung",
  MINDESTLOHN: "Mindestlohn-Erklärung (§ 14 AEntG)",
  GEWERBE: "Gewerbeanmeldung / Handwerksrolle",
  SONSTIGES: "Sonstiger Nachweis",
};
export const NU_DOC_SHORT: Record<NuDocKind, string> = {
  FREISTELLUNG_48B: "§ 48b",
  UNBEDENKLICHKEIT_FA: "Finanzamt",
  UNBEDENKLICHKEIT_KK: "Krankenkasse",
  BG: "BG",
  SOKA: "SOKA",
  HAFTPFLICHT: "Haftpflicht",
  MINDESTLOHN: "Mindestlohn",
  GEWERBE: "Gewerbe",
  SONSTIGES: "Sonstiges",
};
/** Pflicht-Nachweise für die Ampel (SOKA-BAU nur im Bauhauptgewerbe – deshalb freiwillig) */
export const NU_REQUIRED: readonly NuDocKind[] = ["FREISTELLUNG_48B", "UNBEDENKLICHKEIT_KK", "BG", "HAFTPFLICHT"];

export const NU_CONTRACT_STATUSES = ["ANGEFRAGT", "BEAUFTRAGT", "IN_ARBEIT", "ABGENOMMEN", "ABGERECHNET", "STORNIERT"] as const;
export type NuContractStatus = (typeof NU_CONTRACT_STATUSES)[number];
export const NU_CONTRACT_LABEL: Record<NuContractStatus, string> = { ANGEFRAGT: "Angefragt", BEAUFTRAGT: "Beauftragt", IN_ARBEIT: "In Arbeit", ABGENOMMEN: "Abgenommen", ABGERECHNET: "Abgerechnet", STORNIERT: "Storniert" };

/** Ab wann ein Nachweis als „läuft bald ab“ gilt */
export const WARN_DAYS = 30;

export type ExpiryState = "gueltig" | "bald" | "abgelaufen" | "ohne";
export const EXPIRY_LABEL: Record<ExpiryState, string> = { gueltig: "gültig", bald: "läuft bald ab", abgelaufen: "abgelaufen", ohne: "ohne Ablaufdatum" };
export const EXPIRY_TONE: Record<ExpiryState, string> = {
  gueltig: "border-ok/30 bg-green-50 text-ok",
  bald: "border-warn/30 bg-amber-50 text-warn",
  abgelaufen: "border-bad/30 bg-red-50 text-bad",
  ohne: "border-line bg-mist text-steel",
};

/** Zustand eines Ablaufdatums (Tag genau, Ablauftag zählt noch als gültig) */
export function expiryState(validUntil: Date | null | undefined, now = new Date(), warnDays = WARN_DAYS): ExpiryState {
  if (!validUntil) return "ohne";
  const end = validUntil.getTime() + 86400_000;
  if (end <= now.getTime()) return "abgelaufen";
  if (end - now.getTime() <= warnDays * 86400_000) return "bald";
  return "gueltig";
}

/** Tage bis zum Ablauf (negativ = seit … abgelaufen) */
export const daysLeft = (d: Date, now = new Date()) => Math.ceil((d.getTime() + 86400_000 - now.getTime()) / 86400_000) - 1;

export type Ampel = "gruen" | "gelb" | "rot";
export const AMPEL_TONE: Record<Ampel, string> = { gruen: "bg-ok", gelb: "bg-warn", rot: "bg-bad" };
export const AMPEL_LABEL: Record<Ampel, string> = { gruen: "Nachweise vollständig", gelb: "Nachweis läuft bald ab", rot: "Nachweis fehlt oder abgelaufen" };

type DocLike = { kind: string; validUntil: Date | null; validFrom?: Date | null };

/** Bester (am längsten gültiger) Nachweis je Art */
export function latestByKind<T extends DocLike>(docs: T[]) {
  const m = new Map<string, T>();
  for (const d of docs) {
    const cur = m.get(d.kind);
    if (!cur || (d.validUntil?.getTime() ?? Infinity) > (cur.validUntil?.getTime() ?? Infinity)) m.set(d.kind, d);
  }
  return m;
}

/** Ampel aus den Pflicht-Nachweisen */
export function ampelOf(docs: DocLike[], now = new Date()): { ampel: Ampel; missing: NuDocKind[]; expired: NuDocKind[]; soon: NuDocKind[] } {
  const best = latestByKind(docs);
  const missing: NuDocKind[] = [], expired: NuDocKind[] = [], soon: NuDocKind[] = [];
  for (const k of NU_REQUIRED) {
    const d = best.get(k);
    if (!d) missing.push(k);
    else {
      const s = expiryState(d.validUntil, now);
      if (s === "abgelaufen") expired.push(k);
      else if (s === "bald") soon.push(k);
    }
  }
  return { ampel: missing.length || expired.length ? "rot" : soon.length ? "gelb" : "gruen", missing, expired, soon };
}

/** Gilt die Freistellung § 48b an diesem Tag? */
export function exemptionValid(docs: DocLike[], at = new Date()) {
  return docs.some((d) => d.kind === "FREISTELLUNG_48B" && (!d.validFrom || d.validFrom.getTime() <= at.getTime()) && d.validUntil && d.validUntil.getTime() + 86400_000 > at.getTime());
}

/** Bagatellgrenze § 48 Abs. 2 EStG: unter 5.000 € Gegenleistung im Kalenderjahr kein Steuerabzug */
export const BAGATELL_EUR = 5000;
/** Bauabzugsteuer 15 % der Gegenleistung (brutto) */
export const BAUABZUG_PCT = 15;
