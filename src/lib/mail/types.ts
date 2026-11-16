// Gemeinsame Typen für beide Postfach-Arten (IMAP/SMTP und Microsoft 365 über Graph).
// `uid` ist immer Text: bei IMAP die Zahl als Text, bei Microsoft die Nachrichten-ID (base64url, sicher in Links).

export class MailError extends Error {}

export type MailSummary = { uid: string; from: string; fromAddress: string; subject: string; date: string | null; seen: boolean; flagged: boolean; hasAttachments: boolean };
export type MailFull = MailSummary & { to: string; cc: string; text: string; messageId: string | null; references: string[]; attachments: { filename: string; size: number }[] };
export type OutgoingMail = { to: string; cc?: string; subject: string; text: string; inReplyTo?: string | null; references?: string[]; attachments?: { filename: string; content: Buffer; contentType: string }[] };

/** Gültige Mail-Kennung aus URL/Werkzeug (IMAP-Zahl oder base64url) */
export const MAIL_ID = /^[A-Za-z0-9_-]{1,600}$/;
export const validMailId = (v: unknown): v is string => typeof v === "string" && MAIL_ID.test(v);
