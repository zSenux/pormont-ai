// Stammdaten von ProMont (Quelle: promont.gmbh + Fußzeile des ProMont-Briefpapiers, Stand 16.11.2026)
export const COMPANY = {
  name: "ProMont GmbH",
  short: "ProMont",
  claim: "Metallbau, Stahlbau & Industriemontage aus einer Hand.",
  tagline: "Metallbau vom Meisterbetrieb – Praxisnah. Präzise. Verlässlich.",
  /** Untertitel unter dem Logo (wie auf dem Briefpapier) */
  subtitle: "Metallbau · Stahlbau · Schlosserei · Rohrleitungsbau",
  street: "Ottmar-Mergenthaler-Str. 6",
  zip: "68167",
  city: "Mannheim",
  phone: "0621 84155234",
  phoneE164: "+4962184155234",
  mobile: "0160-98345922",
  email: "info@promont.gmbh",
  website: "https://promont.gmbh",
  /** Schreibweise auf Belegen */
  web: "www.promont.gmbh",
  managers: ["Dirk Linke (Metallbaumeister, Betriebsleiter)", "Josip Cabraja"],
  register: "Amtsgericht Mannheim, HRB 742630",
  vatId: "DE350131180",
  /** Standard-Bankverbindung (Briefpapier). Gilt, solange unter Buchhaltung → Einstellungen keine eigene IBAN steht. */
  bank: { name: "Deutsche Bank AG", iban: "DE16670700240110502200", bic: "DEUTDEDBMAN" },
  chamber: "Handwerkskammer Mannheim Rhein-Neckar-Odenwald",
  services: {
    privat: ["Geländer", "Treppen & Handläufe", "Tore & Türen", "Sonderanfertigungen"],
    gewerbe: ["Stahlbau", "Rohrleitungsbau", "Industriemontage", "Metallbau für Gewerbe"],
  },
  region: "Mannheim und Rhein-Neckar-Region",
} as const;

/** Kurzprofil für den System-Prompt */
export function companyProfile() {
  const c = COMPANY;
  return `${c.name}, ${c.street}, ${c.zip} ${c.city} – Metallbau-Meisterbetrieb (${c.region}).
Leistungen Privatkunden: ${c.services.privat.join(", ")}. Industrie & Gewerbe: ${c.services.gewerbe.join(", ")}.
Geschäftsführung: ${c.managers.join(" und ")}. Telefon ${c.phone}, Mobil ${c.mobile}, ${c.email}, ${c.web}.
Handelsregister ${c.register}, USt-IdNr. ${c.vatId}. Leitsatz: „${c.claim}“`;
}
