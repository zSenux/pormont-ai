import "server-only";

// Postfach der ProMont GmbH über IMAP (lesen) + SMTP (senden).
// Vorlagen für Strato und GMX; eigene Server über MAIL_IMAP_HOST/MAIL_SMTP_HOST.
// Zugangsdaten: Einstellungen → Verbindungen (verschlüsselt in der Datenbank) oder Umgebungsvariablen – nie im Repo.

export const PROVIDERS = {
  strato: { label: "Strato", imap: { host: "imap.strato.de", port: 993 }, smtp: { host: "smtp.strato.de", port: 465 } },
  gmx: { label: "GMX", imap: { host: "imap.gmx.net", port: 993 }, smtp: { host: "mail.gmx.net", port: 465 } },
  ionos: { label: "IONOS", imap: { host: "imap.ionos.de", port: 993 }, smtp: { host: "smtp.ionos.de", port: 465 } },
} as const;

export type MailConfig = {
  provider: string;
  user: string;
  password: string;
  fromName: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
};

export function mailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const password = process.env.MAIL_PASSWORD;
  if (!user || !password) return null;
  const key = (process.env.MAIL_PROVIDER || (/@gmx\./i.test(user) ? "gmx" : "strato")).toLowerCase() as keyof typeof PROVIDERS;
  const preset = PROVIDERS[key] ?? PROVIDERS.strato;
  const imapPort = Number(process.env.MAIL_IMAP_PORT) || preset.imap.port;
  const smtpPort = Number(process.env.MAIL_SMTP_PORT) || preset.smtp.port;
  return {
    provider: PROVIDERS[key]?.label ?? (process.env.MAIL_IMAP_HOST ? "eigener Server" : preset.label),
    user,
    password,
    fromName: process.env.MAIL_FROM_NAME || "ProMont GmbH",
    imap: { host: process.env.MAIL_IMAP_HOST || preset.imap.host, port: imapPort, secure: process.env.MAIL_IMAP_SECURE ? process.env.MAIL_IMAP_SECURE === "1" : imapPort === 993 },
    smtp: { host: process.env.MAIL_SMTP_HOST || preset.smtp.host, port: smtpPort, secure: process.env.MAIL_SMTP_SECURE ? process.env.MAIL_SMTP_SECURE === "1" : smtpPort === 465 },
  };
}

export const mailConfigured = () => mailConfig() !== null;
