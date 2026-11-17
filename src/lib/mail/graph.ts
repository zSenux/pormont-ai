import "server-only";
import { mailConfig, type GraphConfig } from "./config";
import { msAccessToken } from "./microsoft";
import { MailError, type MailFull, type MailSummary, type OutgoingMail } from "./types";

// Microsoft 365 / Outlook (Exchange Online) über Microsoft Graph.
// Gleiche Funktionen wie imap.ts – die übrige App merkt keinen Unterschied.
// Nachrichten-IDs sind unveränderlich (ImmutableId) und werden als base64url in Links/Werkzeugen verwendet.
// Gesendete Mails legt Exchange selbst in „Gesendete Elemente“ ab.

// MS_GRAPH_URL nur für lokale Tests mit einem Nachbau (nie in Produktion setzen)
const GRAPH = process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0";

function cfg(): GraphConfig {
  const c = mailConfig();
  if (!c || c.kind !== "graph") throw new MailError("Das Microsoft-Postfach ist noch nicht verbunden – unter Einstellungen → Verbindungen „Mit Microsoft anmelden“.");
  return c;
}

const encodeId = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function decodeId(uid: string) {
  const id = Buffer.from(uid, "base64url").toString("utf8");
  if (!id || !/^[A-Za-z0-9+/=_-]+$/.test(id)) throw new MailError("Mail nicht gefunden.");
  return encodeURIComponent(id);
}

/** Pfad zum Postfach: eigenes (/me) oder geteiltes (/users/info@…) */
const box = (c: GraphConfig) => (c.mailbox ? `/users/${encodeURIComponent(c.mailbox)}` : "/me");

type Opts = { method?: string; body?: unknown; text?: boolean; raw?: boolean };

async function call<T = unknown>(path: string, o: Opts = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  let renew = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await msAccessToken(renew);
    renew = false;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Prefer: `IdType="ImmutableId"${o.text ? ', outlook.body-content-type="text"' : ""}` };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(url, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new MailError("Microsoft 365 ist nicht erreichbar.");
    }
    if (res.status === 401 && attempt === 0) {
      renew = true; // Token erneuern und nochmal
      continue;
    }
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw await graphError(res);
    if (o.raw) return Buffer.from(await res.arrayBuffer()) as T;
    if (res.status === 202 || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  throw new MailError("Microsoft 365 antwortet gerade nicht – bitte gleich nochmal versuchen.");
}

async function graphError(res: Response) {
  const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  const code = j.error?.code ?? "";
  if (res.status === 404 || /ErrorItemNotFound|ResourceNotFound/i.test(code)) return new MailError("Mail nicht gefunden.");
  if (res.status === 403 || /AccessDenied|ErrorAccessDenied/i.test(code))
    return new MailError(cfg().mailbox ? `Kein Zugriff auf das geteilte Postfach ${cfg().mailbox} – im Microsoft 365 Admin Center dem angemeldeten Konto „Vollzugriff“ und „Senden als“ geben.` : "Microsoft verweigert den Zugriff – Berechtigungen der App prüfen (siehe Anleitung).");
  if (/MailboxNotEnabledForRESTAPI|MailboxNotFound/i.test(code)) return new MailError("Für dieses Konto gibt es kein Exchange-Online-Postfach (Microsoft-365-Lizenz mit Exchange nötig).");
  return new MailError(`Fehler bei Microsoft 365: ${(j.error?.message ?? res.statusText).slice(0, 200)}`);
}

type GAddr = { emailAddress?: { name?: string; address?: string } };
type GMsg = {
  id: string;
  subject?: string | null;
  from?: GAddr | null;
  receivedDateTime?: string | null;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  toRecipients?: GAddr[];
  ccRecipients?: GAddr[];
  body?: { contentType?: string; content?: string };
  internetMessageId?: string | null;
  internetMessageHeaders?: { name: string; value: string }[];
};
type GAttachment = { id: string; name?: string; size?: number; isInline?: boolean; contentType?: string };

const SUMMARY = "id,subject,from,receivedDateTime,isRead,flag,hasAttachments";
const fmt = (a?: GAddr[]) => (a ?? []).map((x) => (x.emailAddress?.name && x.emailAddress.name !== x.emailAddress.address ? `${x.emailAddress.name} <${x.emailAddress.address}>` : (x.emailAddress?.address ?? ""))).filter(Boolean).join(", ");

function summary(m: GMsg): MailSummary {
  return {
    uid: encodeId(m.id),
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unbekannt",
    fromAddress: m.from?.emailAddress?.address ?? "",
    subject: m.subject || "(ohne Betreff)",
    date: m.receivedDateTime ?? null,
    seen: Boolean(m.isRead),
    flagged: m.flag?.flagStatus === "flagged",
    hasAttachments: Boolean(m.hasAttachments),
  };
}

export async function listMails(opts: { limit?: number; unread?: boolean; search?: string; folder?: string } = {}): Promise<{ mails: MailSummary[]; unread: number; total: number }> {
  const c = cfg();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const folder = `${box(c)}/mailFolders/inbox`;
  const q = new URLSearchParams({ $select: SUMMARY, $top: String(limit) });
  if (opts.search) {
    // $search lässt keine Sortierung/Filter zu → ungelesen danach selbst filtern
    q.set("$search", `"${opts.search.replace(/["\\]/g, " ").trim()}"`);
    q.set("$top", String(opts.unread ? 50 : limit));
  } else {
    q.set("$orderby", "receivedDateTime desc");
    // Exchange verlangt: Sortier-Feld zuerst im Filter
    if (opts.unread) q.set("$filter", "receivedDateTime ge 2000-01-01T00:00:00Z and isRead eq false");
  }
  const [list, info] = await Promise.all([call<{ value: GMsg[] }>(`${folder}/messages?${q}`), call<{ unreadItemCount?: number; totalItemCount?: number }>(`${folder}?$select=unreadItemCount,totalItemCount`)]);
  let mails = list.value.map(summary);
  if (opts.search && opts.unread) mails = mails.filter((m) => !m.seen);
  mails = mails.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, limit);
  return { mails, unread: info.unreadItemCount ?? 0, total: info.totalItemCount ?? 0 };
}

async function attachmentsOf(c: GraphConfig, id: string): Promise<GAttachment[]> {
  const r = await call<{ value: GAttachment[] }>(`${box(c)}/messages/${id}/attachments?$select=id,name,size,isInline,contentType`);
  return r.value.filter((a) => !a.isInline);
}

export async function readMail(uid: string, markRead = false): Promise<MailFull> {
  const c = cfg();
  const id = decodeId(uid);
  const m = await call<GMsg>(`${box(c)}/messages/${id}?$select=${SUMMARY},toRecipients,ccRecipients,body,internetMessageId,internetMessageHeaders`, { text: true });
  const atts = m.hasAttachments ? await attachmentsOf(c, id) : [];
  if (markRead && !m.isRead) await call(`${box(c)}/messages/${id}`, { method: "PATCH", body: { isRead: true } });
  const refs = m.internetMessageHeaders?.find((h) => h.name.toLowerCase() === "references")?.value ?? "";
  return {
    ...summary(m),
    seen: markRead || Boolean(m.isRead),
    to: fmt(m.toRecipients),
    cc: fmt(m.ccRecipients),
    // Mit „outlook.body-content-type=text“ liefert Exchange bereits Text (nie HTML ins DOM)
    text: (m.body?.contentType === "html" ? (m.body.content ?? "").replace(/<[^>]+>/g, " ") : (m.body?.content ?? "")).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    messageId: m.internetMessageId ?? null,
    references: refs.split(/\s+/).filter((r) => /^<.+>$/.test(r)),
    attachments: atts.map((a) => ({ filename: a.name ?? "Anhang", size: a.size ?? 0 })),
  };
}

export async function setFlag(uid: string, flag: "seen" | "flagged", on: boolean) {
  const c = cfg();
  await call(`${box(c)}/messages/${decodeId(uid)}`, { method: "PATCH", body: flag === "seen" ? { isRead: on } : { flag: { flagStatus: on ? "flagged" : "notFlagged" } } });
}

/** „Name <a@b.de>, c@d.de“ → Empfänger-Liste für Graph */
function recipients(list?: string) {
  return (list ?? "")
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(.*)<([^<>]+)>$/.exec(x);
      const address = (m ? m[2] : x).trim();
      const name = m ? m[1].trim().replace(/^"|"$/g, "") : "";
      return { emailAddress: name ? { address, name } : { address } };
    });
}

const CHUNK = 320 * 1024 * 12; // Upload-Stücke müssen ein Vielfaches von 320 KiB sein

async function addAttachments(c: GraphConfig, draftId: string, atts: OutgoingMail["attachments"]) {
  for (const a of atts ?? []) {
    if (a.content.length <= 3 * 1024 * 1024) {
      await call(`${box(c)}/messages/${draftId}/attachments`, { method: "POST", body: { "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.content.toString("base64"), ...(a.cid ? { isInline: true, contentId: a.cid } : {}) } });
      continue;
    }
    // Große Anhänge (> 3 MB) in Stücken hochladen
    const s = await call<{ uploadUrl: string }>(`${box(c)}/messages/${draftId}/attachments/createUploadSession`, { method: "POST", body: { AttachmentItem: { attachmentType: "file", name: a.filename, size: a.content.length, contentType: a.contentType } } });
    for (let start = 0; start < a.content.length; start += CHUNK) {
      const part = a.content.subarray(start, start + CHUNK);
      const res = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${start + part.length - 1}/${a.content.length}` }, body: new Uint8Array(part), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new MailError(`Anhang „${a.filename}“ konnte nicht hochgeladen werden.`);
    }
  }
}

/** Entwurf anlegen – bei Antworten als Antwort auf die Original-Mail (Verlauf bleibt in Outlook zusammen) */
async function createDraft(c: GraphConfig, m: OutgoingMail): Promise<{ id: string; internetMessageId: string | null }> {
  let original: string | null = null;
  if (m.inReplyTo) {
    const f = await call<{ value: { id: string }[] }>(`${box(c)}/messages?$select=id&$top=1&$filter=${encodeURIComponent(`internetMessageId eq '${m.inReplyTo.replace(/'/g, "''")}'`)}`).catch(() => ({ value: [] }));
    original = f.value[0]?.id ?? null;
  }
  const fields = { subject: m.subject, body: m.html ? { contentType: "HTML", content: m.html } : { contentType: "Text", content: m.text }, toRecipients: recipients(m.to), ccRecipients: recipients(m.cc) };
  let d: { id: string; internetMessageId?: string | null };
  if (original) {
    d = await call(`${box(c)}/messages/${encodeURIComponent(original)}/createReply`, { method: "POST" });
    d = await call(`${box(c)}/messages/${encodeURIComponent(d.id)}`, { method: "PATCH", body: fields });
  } else {
    d = await call(`${box(c)}/messages`, { method: "POST", body: { ...fields, ...(c.mailbox ? { from: { emailAddress: { address: c.mailbox, name: c.fromName } } } : {}) } });
  }
  const id = encodeURIComponent(d.id);
  try {
    await addAttachments(c, id, m.attachments);
  } catch (e) {
    // halben Entwurf nicht liegen lassen
    await call(`${box(c)}/messages/${id}`, { method: "DELETE" }).catch(() => undefined);
    throw e;
  }
  return { id, internetMessageId: d.internetMessageId ?? null };
}

export async function sendMail(m: OutgoingMail): Promise<{ messageId: string }> {
  const c = cfg();
  const d = await createDraft(c, m);
  try {
    await call(`${box(c)}/messages/${d.id}/send`, { method: "POST" });
  } catch (e) {
    // Entwurf nicht als Leiche liegen lassen
    await call(`${box(c)}/messages/${d.id}`, { method: "DELETE" }).catch(() => undefined);
    throw e;
  }
  return { messageId: d.internetMessageId ?? "" };
}

export async function saveDraft(m: OutgoingMail): Promise<{ folder: string }> {
  await createDraft(cfg(), m);
  return { folder: "Entwürfe" };
}

export async function mailStatus(): Promise<{ ok: boolean; text: string }> {
  const c = cfg();
  try {
    const i = await call<{ unreadItemCount?: number }>(`${box(c)}/mailFolders/inbox?$select=unreadItemCount`);
    return { ok: true, text: `${c.mailbox ?? c.user} (Microsoft 365${c.mailbox ? `, angemeldet als ${c.user}` : ""}) · ${i.unreadItemCount ?? 0} ungelesen` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." };
  }
}

export async function mailAttachment(uid: string, index: number): Promise<{ filename: string; contentType: string; content: Buffer }> {
  const c = cfg();
  const id = decodeId(uid);
  const a = (await attachmentsOf(c, id))[index];
  if (!a) throw new MailError("Anhang nicht gefunden.");
  const content = await call<Buffer>(`${box(c)}/messages/${id}/attachments/${encodeURIComponent(a.id)}/$value`, { raw: true });
  return { filename: a.name ?? `anhang-${index + 1}`, contentType: a.contentType ?? "application/octet-stream", content };
}

/** Neue Mails seit dem letzten Lauf (für Push). Merkt sich den Eingangszeitpunkt der neuesten Mail. */
export async function mailsSince(last: { uid: number | string; validity: string } | null): Promise<{ validity: string; maxUid: string; mails: MailSummary[] }> {
  const c = cfg();
  const validity = `graph:${c.mailbox ?? c.user}`;
  const since = last && last.validity === validity && typeof last.uid === "string" && !Number.isNaN(Date.parse(last.uid)) ? last.uid : null;
  if (!since) return { validity, maxUid: new Date().toISOString(), mails: [] };
  const q = new URLSearchParams({ $select: SUMMARY, $top: "20", $orderby: "receivedDateTime asc", $filter: `receivedDateTime gt ${new Date(since).toISOString()}` });
  const r = await call<{ value: GMsg[] }>(`${box(c)}/mailFolders/inbox/messages?${q}`);
  const mails = r.value.map(summary);
  return { validity, maxUid: mails.at(-1)?.date ?? since, mails };
}
