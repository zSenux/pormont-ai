// Gemeinsame Typen für beide Postfach-Arten (IMAP/SMTP und Microsoft 365 über Graph).
// `uid` ist immer Text: bei IMAP die Zahl als Text, bei Microsoft die Nachrichten-ID (base64url, sicher in Links).

export class MailError extends Error {}

export type MailSummary = { uid: string; from: string; fromAddress: string; subject: string; date: string | null; seen: boolean; flagged: boolean; hasAttachments: boolean };
/** Ordner im Postfach. `key` = Kennung für Links ("" = Posteingang), bei IMAP base64url des Pfads, bei Microsoft base64url der Ordner-ID */
export type MailFolder = { key: string; name: string; total: number; unread: number; kind: "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | null; depth: number };

export type ListOpts = {
  limit?: number;
  unread?: boolean;
  search?: string;
  /** Ordner-Kennung aus listFolders ("" bzw. leer = Posteingang) */
  folder?: string;
  /** Suche über alle Ordner (nur zusammen mit search) */
  allFolders?: boolean;
  /** Fortsetzung aus dem letzten Aufruf (`next`) */
  cursor?: string;
};

export type MailList = {
  mails: MailSummary[];
  /** ungelesen / gesamt im gewählten Ordner */
  unread: number;
  total: number;
  /** Anzahl Treffer bei Suche/Filter, falls bekannt (Microsoft liefert bei Suche keine Zahl) */
  hits: number | null;
  /** zum Weiterladen, null = Ende */
  next: string | null;
  folderName: string;
};

export type MailFull = MailSummary & { to: string; cc: string; text: string; messageId: string | null; references: string[]; attachments: { filename: string; size: number }[] };
export type OutgoingMail = {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  /** wird von withSignature gesetzt (Text bleibt als zweiter Teil) */
  html?: string;
  /** true/leer = mit Signatur, "system" = Belege/Mahnungen/Preisanfragen (Schalter in den Einstellungen), false = ohne */
  signature?: boolean | "system";
  inReplyTo?: string | null;
  references?: string[];
  /** cid = eingebettetes Bild (Logo der Signatur) */
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
};

/** Gültige Mail-Kennung aus URL/Werkzeug (IMAP-Zahl oder base64url) */
export const MAIL_ID = /^[A-Za-z0-9_-]{1,600}$/;
export const validMailId = (v: unknown): v is string => typeof v === "string" && MAIL_ID.test(v);
/** Ordner-Kennung / Fortsetzung aus URL */
export const validKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{0,2000}$/.test(v);
