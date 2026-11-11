import "server-only";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { mailConfig, type MailConfig } from "./config";

export class MailError extends Error {}

export type MailSummary = { uid: number; from: string; fromAddress: string; subject: string; date: string | null; seen: boolean; flagged: boolean; hasAttachments: boolean };
export type MailFull = MailSummary & { to: string; cc: string; text: string; messageId: string | null; references: string[]; attachments: { filename: string; size: number }[] };

function cfg(): MailConfig {
  const c = mailConfig();
  if (!c) throw new MailError("Das Postfach ist noch nicht verbunden (MAIL_USER/MAIL_PASSWORD fehlen).");
  return c;
}

function german(e: unknown): MailError {
  const m = e instanceof Error ? `${e.message} ${(e as { responseText?: string }).responseText ?? ""}` : String(e);
  if (/auth|login|credentials|password/i.test(m)) return new MailError("Anmeldung am Postfach fehlgeschlagen – E-Mail-Adresse/Passwort prüfen (bei GMX muss IMAP in den Einstellungen erlaubt sein).");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return new MailError("Mailserver nicht erreichbar.");
  return new MailError(`Fehler beim Postfach: ${m.slice(0, 200)}`);
}

/** Eine IMAP-Verbindung je Aufruf (kurz, robust gegen Abbrüche) */
async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = cfg();
  const client = new ImapFlow({ host: c.imap.host, port: c.imap.port, secure: c.imap.secure, auth: { user: c.user, pass: c.password }, logger: false, socketTimeout: 30_000, tls: { rejectUnauthorized: process.env.MAIL_TLS_INSECURE !== "1" } });
  try {
    await client.connect();
  } catch (e) {
    throw german(e);
  }
  try {
    return await fn(client);
  } catch (e) {
    throw e instanceof MailError ? e : german(e);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const addr = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : (a?.text ?? ""));

function summary(m: FetchMessageObject): MailSummary {
  const f = m.envelope?.from?.[0];
  const parts = JSON.stringify(m.bodyStructure ?? {});
  return {
    uid: m.uid,
    from: f?.name || f?.address || "Unbekannt",
    fromAddress: f?.address ?? "",
    subject: m.envelope?.subject || "(ohne Betreff)",
    date: (() => { const d = m.envelope?.date ?? m.internalDate; return d ? new Date(d).toISOString() : null; })(),
    seen: m.flags?.has("\\Seen") ?? false,
    flagged: m.flags?.has("\\Flagged") ?? false,
    hasAttachments: /"disposition":"attachment"/i.test(parts),
  };
}

/** Ordner per Spezial-Kennzeichen finden (Strato „Gesendete Objekte“, GMX „Gesendet“ …) */
async function specialFolder(c: ImapFlow, use: "\\Sent" | "\\Drafts"): Promise<string | null> {
  const list = await c.list();
  const hit = list.find((f) => f.specialUse === use) ?? list.find((f) => (use === "\\Sent" ? /^(sent|gesendet|gesendete)/i : /^(drafts|entw)/i).test(f.name));
  return hit?.path ?? null;
}

/** Neueste Mails im Posteingang (optional nur ungelesene oder Suche in Absender/Betreff/Text) */
export async function listMails(opts: { limit?: number; unread?: boolean; search?: string; folder?: string } = {}): Promise<{ mails: MailSummary[]; unread: number; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(opts.folder ?? "INBOX", { readOnly: true });
    try {
      const status = (await c.status(opts.folder ?? "INBOX", { unseen: true, messages: true })) || { unseen: 0, messages: 0 };
      const query = opts.search ? { or: [{ from: opts.search }, { subject: opts.search }, { body: opts.search }], ...(opts.unread ? { seen: false } : {}) } : opts.unread ? { seen: false } : { all: true };
      const uids = ((await c.search(query, { uid: true })) || []).slice(-limit);
      const mails: MailSummary[] = [];
      if (uids.length) for await (const m of c.fetch(uids, { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) mails.push(summary(m));
      mails.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { mails, unread: status.unseen ?? 0, total: status.messages ?? 0 };
    } finally {
      lock.release();
    }
  });
}

/** Eine Mail lesen (Text, HTML wird zu Text) – markiert sie als gelesen, wenn markRead */
export async function readMail(uid: number, markRead = false): Promise<MailFull> {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, source: true }, { uid: true });
      if (!m || !m.source) throw new MailError("Mail nicht gefunden.");
      const p = await simpleParser(m.source);
      if (markRead && !m.flags?.has("\\Seen")) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      const text = (p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "")).replace(/\n{3,}/g, "\n\n").trim();
      return {
        ...summary(m),
        seen: markRead || (m.flags?.has("\\Seen") ?? false),
        to: addr(p.to),
        cc: addr(p.cc),
        text,
        messageId: p.messageId ?? null,
        references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [],
        attachments: p.attachments.map((a) => ({ filename: a.filename ?? "Anhang", size: a.size })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function setFlag(uid: number, flag: "\\Seen" | "\\Flagged", on: boolean) {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      if (on) await c.messageFlagsAdd(String(uid), [flag], { uid: true });
      else await c.messageFlagsRemove(String(uid), [flag], { uid: true });
    } finally {
      lock.release();
    }
  });
}

export type OutgoingMail = { to: string; cc?: string; subject: string; text: string; inReplyTo?: string | null; references?: string[] };

function compose(c: MailConfig, m: OutgoingMail) {
  return {
    from: { name: c.fromName, address: c.user },
    to: m.to,
    cc: m.cc || undefined,
    subject: m.subject,
    text: m.text,
    inReplyTo: m.inReplyTo || undefined,
    references: m.references?.length ? m.references : m.inReplyTo ? [m.inReplyTo] : undefined,
  };
}

/** Senden über SMTP + Kopie in „Gesendet“ (Strato/GMX legen sie nicht selbst ab) */
export async function sendMail(m: OutgoingMail): Promise<{ messageId: string }> {
  const c = cfg();
  const transport = nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, auth: { user: c.user, pass: c.password }, tls: { rejectUnauthorized: process.env.MAIL_TLS_INSECURE !== "1" } });
  const message = compose(c, m);
  let info;
  try {
    info = await transport.sendMail(message);
  } catch (e) {
    throw german(e);
  }
  try {
    const raw = await new MailComposer({ ...message, messageId: info.messageId }).compile().build();
    await withImap(async (imap) => {
      const sent = await specialFolder(imap, "\\Sent");
      if (sent) await imap.append(sent, raw, ["\\Seen"]);
    });
  } catch (e) {
    console.warn("[mail] Kopie in Gesendet fehlgeschlagen:", e instanceof Error ? e.message : e);
  }
  return { messageId: info.messageId };
}

/** Entwurf im Postfach-Ordner „Entwürfe“ ablegen (sendet nichts) */
export async function saveDraft(m: OutgoingMail): Promise<{ folder: string }> {
  const c = cfg();
  const raw = await new MailComposer(compose(c, m)).compile().build();
  return withImap(async (imap) => {
    const folder = (await specialFolder(imap, "\\Drafts")) ?? "Drafts";
    await imap.append(folder, raw, ["\\Draft", "\\Seen"]);
    return { folder };
  });
}

/** Verbindungstest für die Einstellungen */
export async function mailStatus(): Promise<{ ok: boolean; text: string }> {
  const c = mailConfig();
  if (!c) return { ok: false, text: "Nicht verbunden – MAIL_USER/MAIL_PASSWORD fehlen." };
  try {
    const unread = await withImap(async (imap) => ((await imap.status("INBOX", { unseen: true })) || { unseen: 0 }).unseen ?? 0);
    return { ok: true, text: `${c.user} (${c.provider}) · ${unread} ungelesen` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." };
  }
}

/** Anhang Nr. n einer Mail (zum Herunterladen) */
export async function mailAttachment(uid: number, index: number): Promise<{ filename: string; contentType: string; content: Buffer }> {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!m || !m.source) throw new MailError("Mail nicht gefunden.");
      const a = (await simpleParser(m.source)).attachments[index];
      if (!a) throw new MailError("Anhang nicht gefunden.");
      return { filename: a.filename ?? `anhang-${index + 1}`, contentType: a.contentType, content: a.content };
    } finally {
      lock.release();
    }
  });
}

/** Neue Mails seit einer UID (für Push). Bei geänderter UIDVALIDITY wird neu begonnen. */
export async function mailsSince(last: { uid: number; validity: string } | null): Promise<{ validity: string; maxUid: number; mails: MailSummary[] }> {
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = c.mailbox;
      const validity = mb ? String(mb.uidValidity) : "0";
      const next = mb ? Number(mb.uidNext) : 1;
      if (!last || last.validity !== validity) return { validity, maxUid: next - 1, mails: [] };
      if (next - 1 <= last.uid) return { validity, maxUid: last.uid, mails: [] };
      const mails: MailSummary[] = [];
      for await (const m of c.fetch(`${last.uid + 1}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) if (m.uid > last.uid) mails.push(summary(m));
      return { validity, maxUid: Math.max(last.uid, ...mails.map((m) => m.uid)), mails: mails.slice(-20) };
    } finally {
      lock.release();
    }
  });
}
