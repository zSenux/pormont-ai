import "server-only";
import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { mailConfig, type ImapConfig as MailConfig } from "./config";
import { MailError, type ListOpts, type MailFolder, type MailFull, type MailList, type MailSummary, type OutgoingMail } from "./types";

// IMAP (lesen) + SMTP (senden) für Strato, GMX, IONOS und eigene Server. Microsoft 365 läuft über graph.ts.

function cfg(): MailConfig {
  const c = mailConfig();
  if (!c || c.kind !== "imap") throw new MailError("Das Postfach ist noch nicht verbunden – unter Einstellungen → Verbindungen eintragen.");
  return c;
}

// Mail-Kennung in Links: Posteingang = nur die UID ("123"), andere Ordner = UID + "-" + base64url(Ordnerpfad).
// UIDs gelten nur innerhalb eines Ordners, deshalb gehört der Ordner zur Kennung.
const enc = (path: string) => Buffer.from(path, "utf8").toString("base64url");
const dec = (key: string) => Buffer.from(key, "base64url").toString("utf8");
const isInbox = (path: string) => path.toUpperCase() === "INBOX";
const mailId = (uid: number, path: string) => (isInbox(path) ? String(uid) : `${uid}-${enc(path)}`);

/** Kennung aus der Oberfläche → UID + Ordner */
function parseId(id: string): { uid: number; folder: string } {
  const m = /^(\d{1,10})(?:-([A-Za-z0-9_-]{1,500}))?$/.exec(id);
  const n = m ? Number(m[1]) : 0;
  if (!m || !Number.isInteger(n) || n <= 0) throw new MailError("Mail nicht gefunden.");
  const folder = m[2] ? dec(m[2]) : "INBOX";
  if (!folder || /[\r\n\0]/.test(folder)) throw new MailError("Mail nicht gefunden.");
  return { uid: n, folder };
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

function summary(m: FetchMessageObject, folder = "INBOX"): MailSummary {
  const f = m.envelope?.from?.[0];
  const parts = JSON.stringify(m.bodyStructure ?? {});
  return {
    uid: mailId(m.uid, folder),
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

const FETCH = { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true } as const;

type ImapFolder = MailFolder & { path: string };

function folderKind(f: { specialUse?: string; path: string; name: string }): MailFolder["kind"] {
  if (isInbox(f.path)) return "inbox";
  const u = f.specialUse ?? "";
  if (u === "\\Sent" || /^(sent|gesendet)/i.test(f.name)) return "sent";
  if (u === "\\Drafts" || /^(drafts|entw)/i.test(f.name)) return "drafts";
  if (u === "\\Trash" || /^(trash|papierkorb|gelöscht|deleted)/i.test(f.name)) return "trash";
  if (u === "\\Junk" || /^(junk|spam)/i.test(f.name)) return "junk";
  if (u === "\\Archive" || /^archiv/i.test(f.name)) return "archive";
  return null;
}
const KIND_NAME: Record<string, string> = { inbox: "Posteingang", sent: "Gesendet", drafts: "Entwürfe", trash: "Papierkorb", junk: "Spam", archive: "Archiv" };
const KIND_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash"];

async function imapFolders(c: ImapFlow, counts = true): Promise<ImapFolder[]> {
  const list = await c.list(counts ? { statusQuery: { messages: true, unseen: true } } : {});
  return list
    .filter((f) => !f.flags?.has("\\Noselect") && !f.flags?.has("\\NonExistent"))
    .map((f) => {
      const kind = folderKind(f);
      const d = f.delimiter || "/";
      const depth = Math.max(0, f.path.split(d).length - 1 - (f.path.toUpperCase().startsWith(`INBOX${d}`) ? 1 : 0));
      return { key: isInbox(f.path) ? "" : enc(f.path), path: f.path, name: (kind && depth === 0 && KIND_NAME[kind]) || f.name, total: f.status?.messages ?? 0, unread: f.status?.unseen ?? 0, kind, depth };
    })
    .sort((a, b) => {
      const ka = a.kind ? KIND_ORDER.indexOf(a.kind) : 99;
      const kb = b.kind ? KIND_ORDER.indexOf(b.kind) : 99;
      return ka - kb || a.path.localeCompare(b.path, "de");
    });
}

/** Alle Ordner mit Anzahl (Posteingang zuerst) */
export async function listFolders(): Promise<MailFolder[]> {
  return withImap(async (c) => (await imapFolders(c)).map(({ path: _p, ...f }) => f));
}

/** Ordner-Kennung prüfen: nur Ordner, die es im Postfach wirklich gibt */
async function resolveFolder(c: ImapFlow, key?: string): Promise<ImapFolder> {
  const all = await imapFolders(c, false);
  const hit = key ? all.find((f) => f.key === key) : (all.find((f) => f.kind === "inbox") ?? { key: "", path: "INBOX", name: "Posteingang", total: 0, unread: 0, kind: "inbox" as const, depth: 0 });
  if (!hit) throw new MailError("Ordner nicht gefunden.");
  // Anzahl nur für diesen einen Ordner abfragen
  const st = (await c.status(hit.path, { unseen: true, messages: true })) || { unseen: 0, messages: 0 };
  return { ...hit, total: st.messages ?? 0, unread: st.unseen ?? 0 };
}

function searchQuery(opts: ListOpts) {
  if (opts.search) return { or: [{ from: opts.search }, { subject: opts.search }, { body: opts.search }], ...(opts.unread ? { seen: false } : {}) };
  return opts.unread ? { seen: false } : { all: true };
}

/** Mails eines Ordners, neueste zuerst, seitenweise (cursor = Anzahl schon geladener Mails). Suche in Absender/Betreff/Text. */
export async function listMails(opts: ListOpts = {}): Promise<MailList> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.min(Math.max(Number(opts.cursor) || 0, 0), 100_000);
  return withImap(async (c) => {
    if (opts.search && opts.allFolders) return searchAll(c, opts, limit, offset);
    const f = await resolveFolder(c, opts.folder);
    const lock = await c.getMailboxLock(f.path, { readOnly: true });
    try {
      const filtered = Boolean(opts.search || opts.unread);
      // Ohne Filter reicht die Nummernfolge des Ordners (schnell auch bei vielen tausend Mails)
      if (!filtered) {
        const exists = c.mailbox ? c.mailbox.exists : 0;
        const to = exists - offset;
        const from = Math.max(1, to - limit + 1);
        const mails: MailSummary[] = [];
        if (to >= 1) for await (const m of c.fetch(`${from}:${to}`, FETCH)) mails.push(summary(m, f.path));
        mails.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        return { mails, unread: f.unread, total: exists, hits: null, next: from > 1 ? String(offset + limit) : null, folderName: f.name };
      }
      const all = ((await c.search(searchQuery(opts), { uid: true })) || []).sort((a, b) => a - b);
      const end = all.length - offset;
      const uids = end > 0 ? all.slice(Math.max(0, end - limit), end) : [];
      const mails = await fetchSummaries(c, uids, f.path);
      return { mails, unread: f.unread, total: f.total, hits: all.length, next: end - limit > 0 ? String(offset + limit) : null, folderName: f.name };
    } finally {
      lock.release();
    }
  });
}

async function fetchSummaries(c: ImapFlow, uids: number[], path: string) {
  const mails: MailSummary[] = [];
  if (uids.length) for await (const m of c.fetch(uids, FETCH, { uid: true })) mails.push(summary(m, path));
  return mails.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Suche über alle Ordner: je Ordner die neuesten Treffer holen, nach Datum mischen */
async function searchAll(c: ImapFlow, opts: ListOpts, limit: number, offset: number): Promise<MailList> {
  const folders = (await imapFolders(c)).filter((f) => f.total > 0).slice(0, 40);
  const inbox = folders.find((f) => f.kind === "inbox");
  const want = Math.min(offset + limit, 1000);
  let hits = 0;
  const found: MailSummary[] = [];
  for (const f of folders) {
    const lock = await c.getMailboxLock(f.path, { readOnly: true });
    try {
      const all = ((await c.search(searchQuery(opts), { uid: true })) || []).sort((a, b) => a - b);
      hits += all.length;
      found.push(...(await fetchSummaries(c, all.slice(-want), f.path)));
    } finally {
      lock.release();
    }
  }
  found.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const mails = found.slice(offset, offset + limit);
  const more = offset + limit < Math.min(hits, 1000);
  return { mails, unread: inbox?.unread ?? 0, total: inbox?.total ?? 0, hits, next: more ? String(offset + limit) : null, folderName: "allen Ordnern" };
}

/** Eine Mail lesen (Text, HTML wird zu Text) – markiert sie als gelesen, wenn markRead */
export async function readMail(id: string, markRead = false): Promise<MailFull> {
  const { uid, folder } = parseId(id);
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder);
    try {
      const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, source: true }, { uid: true });
      if (!m || !m.source) throw new MailError("Mail nicht gefunden.");
      const p = await simpleParser(m.source);
      if (markRead && !m.flags?.has("\\Seen")) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      const text = (p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "")).replace(/\n{3,}/g, "\n\n").trim();
      return {
        ...summary(m, folder),
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
  const { uid, folder } = parseId(id);
  const f = flag === "seen" ? "\\Seen" : "\\Flagged";
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder);
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
  const { uid, folder } = parseId(id);
  return withImap(async (c) => {
    const lock = await c.getMailboxLock(folder, { readOnly: true });
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
