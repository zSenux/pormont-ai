import "server-only";
import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { mailConfig, type ImapConfig as MailConfig } from "./config";
import { MailError, type MailFull, type MailSummary, type OutgoingMail } from "./types";

// IMAP (lesen) + SMTP (senden) für Strato, GMX, IONOS und eigene Server. Microsoft 365 läuft über graph.ts.

function cfg(): MailConfig {
  const c = mailConfig();
  if (!c || c.kind !== "imap") throw new MailError("Das Postfach ist noch nicht verbunden – unter Einstellungen → Verbindungen eintragen.");
  return c;
}

/** UID aus der Oberfläche (Text) → Zahl */
function num(uid: string) {
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) throw new MailError("Mail nicht gefunden.");
  return n;
}

/** Hinweis, wenn Microsoft 365 die Anmeldung mit Passwort ablehnt (Basic Auth bzw. SMTP AUTH abgeschaltet) */
export const MS_PASSWORD_BLOCKED =
  "Microsoft 365 lässt die Anmeldung nur mit Passwort für dieses Postfach nicht zu (bei Microsoft „Basic Auth“/„SMTP AUTH“ abgeschaltet). Wenn E-Mail und Passwort sicher stimmen, bitte Anbieter „Microsoft 365 – Mit Microsoft anmelden“ wählen – Anleitung unter Einstellungen → Verbindungen.";

function german(e: unknown, smtp = false): MailError {
  const m = e instanceof Error ? `${e.message} ${(e as { responseText?: string }).responseText ?? ""} ${(e as { response?: string }).response ?? ""}` : String(e);
  if (mailConfig()?.kind === "imap" && (mailConfig() as MailConfig).preset === "office365") {
    if (/SmtpClientAuthentication is disabled|5\.7\.139|basic authentication is disabled|BasicAuthBlocked|LogonDenied/i.test(m)) return new MailError(MS_PASSWORD_BLOCKED);
    if (/5\.7\.3|535|auth|login|credentials|password/i.test(m))
      return new MailError(
        `Microsoft 365 hat die Anmeldung ${smtp ? "zum Senden (SMTP)" : "am Postfach (IMAP)"} abgelehnt. Entweder stimmen E-Mail/Passwort nicht (bei Zwei-Faktor-Anmeldung ggf. ein App-Kennwort nötig), oder Microsoft hat die Passwort-Anmeldung gesperrt – dann Anbieter „Microsoft 365 – Mit Microsoft anmelden“ nutzen.`,
      );
  }
  if (/auth|login|credentials|password/i.test(m)) return new MailError("Anmeldung am Postfach fehlgeschlagen – E-Mail-Adresse/Passwort prüfen (bei GMX muss IMAP in den Einstellungen erlaubt sein).");
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|greeting/i.test(m)) return new MailError("Mailserver nicht erreichbar oder antwortet nicht.");
  return new MailError(`Fehler beim Postfach: ${m.slice(0, 200)}`);
}

// Schutz, damit ein abgelehntes oder nicht erreichbares Postfach nie die App lahmlegt:
// - feste Zeitlimits für Verbindung und Gesamtdauer
// - Fehler-Ereignisse des Sockets werden abgefangen (sonst stürzt der ganze Server ab)
// - nach abgelehnter Anmeldung 15 Min. Pause (sonst sperrt Microsoft das Konto wegen vieler Fehlversuche),
//   neue Zugangsdaten heben die Pause sofort auf
const LIMIT_MS = 25_000;
type Pause = { key: string; until: number; error: string };
const pauseStore = globalThis as { __pmMailPause?: Pause };
const pauseKey = (c: MailConfig) => createHash("sha256").update(`${c.imap.host}|${c.smtp.host}|${c.user}|${c.password}`).digest("hex");
const isAuthError = (e: unknown) => {
  const m = e instanceof Error ? `${e.message} ${(e as { responseText?: string }).responseText ?? ""} ${(e as { response?: string }).response ?? ""}` : String(e);
  return Boolean((e as { authenticationFailed?: boolean })?.authenticationFailed) || /auth|login failed|credentials|password|5\.7\.(3|139)|535/i.test(m);
};
function checkPause(c: MailConfig) {
  const p = pauseStore.__pmMailPause;
  if (p && p.key === pauseKey(c) && p.until > Date.now()) throw new MailError(`${p.error} (Jarvis versucht es in ${Math.max(1, Math.ceil((p.until - Date.now()) / 60_000))} Min. wieder – oder Zugangsdaten neu speichern.)`);
}
function rememberFailure(c: MailConfig, e: unknown, err: MailError) {
  if (isAuthError(e)) pauseStore.__pmMailPause = { key: pauseKey(c), until: Date.now() + 15 * 60_000, error: err.message };
}

function deadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => {
        onTimeout();
        reject(new MailError("Mailserver antwortet nicht (Zeitüberschreitung)."));
      }, ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Eine IMAP-Verbindung je Aufruf (kurz, robust gegen Abbrüche) */
async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = cfg();
  checkPause(c);
  const client = new ImapFlow({
    host: c.imap.host,
    port: c.imap.port,
    secure: c.imap.secure,
    auth: { user: c.user, pass: c.password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { rejectUnauthorized: process.env.MAIL_TLS_INSECURE !== "1" },
  });
  client.on("error", (e: Error) => console.warn("[mail] IMAP:", e?.message ?? e));
  const run = async () => {
    try {
      await client.connect();
    } catch (e) {
      const err = german(e);
      rememberFailure(c, e, err);
      throw err;
    }
    try {
      return await fn(client);
    } catch (e) {
      throw e instanceof MailError ? e : german(e);
    } finally {
      await deadline(client.logout(), 5_000, () => client.close()).catch(() => client.close());
    }
  };
  return deadline(run(), LIMIT_MS, () => client.close());
}

const addr = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : (a?.text ?? ""));

function summary(m: FetchMessageObject): MailSummary {
  const f = m.envelope?.from?.[0];
  const parts = JSON.stringify(m.bodyStructure ?? {});
  return {
    uid: String(m.uid),
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
export async function readMail(id: string, markRead = false): Promise<MailFull> {
  const uid = num(id);
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

export async function setFlag(id: string, flag: "seen" | "flagged", on: boolean) {
  const uid = num(id);
  const f = flag === "seen" ? "\\Seen" : "\\Flagged";
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      if (on) await c.messageFlagsAdd(String(uid), [f], { uid: true });
      else await c.messageFlagsRemove(String(uid), [f], { uid: true });
    } finally {
      lock.release();
    }
  });
}

function compose(c: MailConfig, m: OutgoingMail) {
  return {
    from: { name: c.fromName, address: c.user },
    to: m.to,
    cc: m.cc || undefined,
    subject: m.subject,
    text: m.text,
    html: m.html || undefined,
    inReplyTo: m.inReplyTo || undefined,
    references: m.references?.length ? m.references : m.inReplyTo ? [m.inReplyTo] : undefined,
    attachments: m.attachments?.length ? m.attachments : undefined,
  };
}

function smtpTransport(c: MailConfig) {
  // Port 587 = STARTTLS (Microsoft 365), 465 = direkt TLS
  return nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, requireTLS: !c.smtp.secure, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, auth: { user: c.user, pass: c.password }, tls: { rejectUnauthorized: process.env.MAIL_TLS_INSECURE !== "1" } });
}

/** Senden über SMTP + Kopie in „Gesendet“ (Strato/GMX legen sie nicht selbst ab) */
export async function sendMail(m: OutgoingMail): Promise<{ messageId: string }> {
  const c = cfg();
  const transport = smtpTransport(c);
  const message = compose(c, m);
  checkPause(c);
  let info;
  try {
    info = await transport.sendMail(message);
  } catch (e) {
    const err = german(e, true);
    rememberFailure(c, e, err);
    throw err;
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
  const c = cfg();
  try {
    const unread = await withImap(async (imap) => ((await imap.status("INBOX", { unseen: true })) || { unseen: 0 }).unseen ?? 0);
    // Bei Microsoft 365 auch das Senden prüfen: dort ist SMTP AUTH oft getrennt abgeschaltet
    if (c.preset === "office365") {
      try {
        await deadline(smtpTransport(c).verify(), 15_000, () => undefined);
      } catch (e) {
        if (e instanceof MailError) return { ok: false, text: `Lesen klappt (${unread} ungelesen), Senden: ${e.message}` };
        rememberFailure(c, e, german(e, true));
        return { ok: false, text: `Lesen klappt (${unread} ungelesen), Senden nicht: ${german(e, true).message}` };
      }
    }
    return { ok: true, text: `${c.user} (${c.provider}) · ${unread} ungelesen` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." };
  }
}

/** Anhang Nr. n einer Mail (zum Herunterladen) */
export async function mailAttachment(id: string, index: number): Promise<{ filename: string; contentType: string; content: Buffer }> {
  const uid = num(id);
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
export async function mailsSince(prev: { uid: number | string; validity: string } | null): Promise<{ validity: string; maxUid: string; mails: MailSummary[] }> {
  const last = prev ? { uid: Number(prev.uid) || 0, validity: prev.validity } : null;
  return withImap(async (c) => {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = c.mailbox;
      const validity = mb ? String(mb.uidValidity) : "0";
      const next = mb ? Number(mb.uidNext) : 1;
      if (!last || last.validity !== validity) return { validity, maxUid: String(next - 1), mails: [] };
      if (next - 1 <= last.uid) return { validity, maxUid: String(last.uid), mails: [] };
      const mails: MailSummary[] = [];
      for await (const m of c.fetch(`${last.uid + 1}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) if (m.uid > last.uid) mails.push(summary(m));
      return { validity, maxUid: String(Math.max(last.uid, ...mails.map((m) => Number(m.uid)))), mails: mails.slice(-20) };
    } finally {
      lock.release();
    }
  });
}
