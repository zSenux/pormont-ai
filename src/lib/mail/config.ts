import "server-only";

// Postfach der ProMont GmbH:
// - IMAP (lesen) + SMTP (senden) mit Vorlagen für Strato, GMX, IONOS; eigene Server über MAIL_IMAP_HOST/MAIL_SMTP_HOST.
// - Microsoft 365 / Outlook (Exchange Online) über Microsoft Graph mit „Mit Microsoft anmelden“ (OAuth, siehe microsoft.ts).
//   Microsoft hat die Anmeldung mit Passwort für IMAP/SMTP abgeschaltet – darum hier kein Passwort, sondern Anmeldung im Browser.
// Zugangsdaten: Einstellungen → Verbindungen (verschlüsselt in der Datenbank) oder Umgebungsvariablen – nie im Repo.

export const PROVIDERS = {
  strato: { label: "Strato", imap: { host: "imap.strato.de", port: 993 }, smtp: { host: "smtp.strato.de", port: 465 } },
  gmx: { label: "GMX", imap: { host: "imap.gmx.net", port: 993 }, smtp: { host: "mail.gmx.net", port: 465 } },
  ionos: { label: "IONOS", imap: { host: "imap.ionos.de", port: 993 }, smtp: { host: "smtp.ionos.de", port: 465 } },
  // Microsoft 365 nur mit E-Mail + Passwort (ohne App-Registrierung). Klappt nur, wenn Microsoft die
  // Passwort-Anmeldung (Basic Auth) für IMAP/SMTP beim Mandanten noch zulässt – sonst Anbieter „microsoft“ (OAuth).
  office365: { label: "Microsoft 365 (Passwort)", imap: { host: "outlook.office365.com", port: 993 }, smtp: { host: "smtp.office365.com", port: 587 } },
} as const;

export type ImapConfig = {
  kind: "imap";
  /** Vorlage (strato, gmx, ionos, office365 …) */
  preset: string;
  provider: string;
  user: string;
  password: string;
  fromName: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
};
export type GraphConfig = {
  kind: "graph";
  provider: string;
  /** Angemeldetes Konto (aus der Anmeldung) */
  user: string;
  /** Optional: geteiltes Postfach (z. B. info@…), sonst das eigene Postfach des angemeldeten Kontos */
  mailbox: string | null;
  fromName: string;
};
export type MailConfig = ImapConfig | GraphConfig;

export const isMicrosoft = () => (process.env.MAIL_PROVIDER ?? "").toLowerCase() === "microsoft";

/** App-Registrierung in Microsoft Entra (Azure) eingetragen? */
export function msAppConfig() {
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const secret = process.env.MS_CLIENT_SECRET?.trim();
  if (!clientId || !secret) return null;
  return { clientId, secret, tenant: (process.env.MS_TENANT?.trim() || "common").replace(/[^\w.-]/g, "") || "common" };
}

export function mailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const fromName = process.env.MAIL_FROM_NAME || "ProMont GmbH";
  if (isMicrosoft()) {
    if (!user || !process.env.MS_REFRESH_TOKEN || !msAppConfig()) return null;
    const mailbox = process.env.MS_MAILBOX?.trim().toLowerCase() || null;
    return { kind: "graph", provider: "Microsoft 365", user, mailbox: mailbox && mailbox !== user.toLowerCase() ? mailbox : null, fromName };
  }
  const password = process.env.MAIL_PASSWORD;
  if (!user || !password) return null;
  const key = (process.env.MAIL_PROVIDER || (/@gmx\./i.test(user) ? "gmx" : "strato")).toLowerCase() as keyof typeof PROVIDERS;
  const preset = PROVIDERS[key] ?? PROVIDERS.strato;
  const imapPort = Number(process.env.MAIL_IMAP_PORT) || preset.imap.port;
  const smtpPort = Number(process.env.MAIL_SMTP_PORT) || preset.smtp.port;
  return {
    kind: "imap",
    preset: PROVIDERS[key] ? key : "custom",
    provider: PROVIDERS[key]?.label ?? (process.env.MAIL_IMAP_HOST ? "eigener Server" : preset.label),
    user,
    password,
    fromName,
    imap: { host: process.env.MAIL_IMAP_HOST || preset.imap.host, port: imapPort, secure: process.env.MAIL_IMAP_SECURE ? process.env.MAIL_IMAP_SECURE === "1" : imapPort === 993 },
    smtp: { host: process.env.MAIL_SMTP_HOST || preset.smtp.host, port: smtpPort, secure: process.env.MAIL_SMTP_SECURE ? process.env.MAIL_SMTP_SECURE === "1" : smtpPort === 465 },
  };
}

export const mailConfigured = () => mailConfig() !== null;

/** Angezeigte Adresse des Postfachs (geteiltes Postfach vor angemeldetem Konto) */
export const mailAddress = (c: MailConfig) => (c.kind === "graph" ? (c.mailbox ?? c.user) : c.user);
