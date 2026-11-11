import "server-only";
import { db } from "@/lib/db";
import { formatEuro } from "@/lib/berlin";
import { LexwareError, permalink } from "@/lib/lexware/client";
import { createContact, createInvoice, createQuotation } from "@/lib/lexware/api";
import { sendMail, MailError } from "@/lib/mail/client";
import { mailInput } from "@/lib/mail/input";
import { contactBody, contactInput, invoiceBody, quotationBody, totals, voucherInput } from "@/lib/lexware/payloads";

// Schreibende Schritte in Lexware laufen NIE direkt aus dem Chat: Jarvis legt eine PendingAction an,
// das Team sieht eine Freigabe-Karte und erst „Freigeben“ führt sie aus (atomar, nur einmal).

export const ACTION_KINDS = ["kunde_anlegen", "rechnung_erstellen", "angebot_erstellen", "mail_senden"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type ActionLink = { label: string; url: string };

/** Prüft die Eingabe und baut den Text für die Freigabe-Karte */
export function describe(kind: ActionKind, input: unknown): { summary: string; payload: unknown } {
  if (kind === "kunde_anlegen") {
    const c = contactInput.parse(input);
    const name = c.art === "firma" ? c.firma : [c.vorname, c.nachname].filter(Boolean).join(" ");
    const parts = [c.art === "firma" && c.nachname ? `Ansprechpartner ${[c.vorname, c.nachname].filter(Boolean).join(" ")}` : null, c.email, c.telefon, [c.strasse, [c.plz, c.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null].filter(Boolean);
    return { summary: `Kunde in Lexware anlegen: ${name}${parts.length ? ` (${parts.join(" · ")})` : ""}`, payload: c };
  }
  if (kind === "mail_senden") {
    const m = mailInput.parse(input);
    return { summary: `E-Mail senden an ${m.an}${m.cc ? ` (CC ${m.cc})` : ""}\nBetreff: ${m.betreff}\n\n${m.text}`, payload: m };
  }
  const v = voucherInput.parse(input);
  const t = totals(v);
  const what = kind === "rechnung_erstellen" ? "Rechnung" : "Angebot";
  const mode = v.festschreiben ? "festschreiben (mit Nummer, nicht mehr änderbar)" : "als Entwurf";
  const lines = v.positionen.map((p) => `${p.menge} ${p.einheit} ${p.name} à ${formatEuro(p.nettoPreis)} netto (${p.ustSatz} %)`).join("; ");
  return {
    summary: `${what} ${mode} für ${v.kundeName ?? "Lexware-Kontakt"}: ${lines}. Summe ${formatEuro(t.net)} netto / ${formatEuro(t.gross)} brutto.`,
    payload: v,
  };
}

export async function proposeAction(chatId: string, userId: string, kind: ActionKind, input: unknown) {
  const { summary, payload } = describe(kind, input);
  return db.pendingAction.create({ data: { chatId, userId, kind, summary, payload: payload as object } });
}

/** Freigabe ausführen – atomar PENDING → laufend, damit ein Doppelklick nichts doppelt anlegt */
export async function executeAction(id: string, userId: string) {
  const claimed = await db.pendingAction.updateMany({ where: { id, status: "PENDING" }, data: { status: "DONE", decidedBy: userId, decidedAt: new Date(), result: "Wird ausgeführt …" } });
  if (claimed.count === 0) {
    const a = await db.pendingAction.findUnique({ where: { id } });
    return { ok: false as const, error: a ? "Diese Aktion wurde schon entschieden." : "Aktion nicht gefunden." };
  }
  const a = await db.pendingAction.findUniqueOrThrow({ where: { id } });
  try {
    let result: string;
    let links: ActionLink[];
    if (a.kind === "kunde_anlegen") {
      const c = contactInput.parse(a.payload);
      const r = await createContact(contactBody(c));
      result = `Kunde in Lexware angelegt.`;
      links = [{ label: "In Lexware öffnen", url: permalink("contacts", r.id) }];
    } else if (a.kind === "rechnung_erstellen" || a.kind === "angebot_erstellen") {
      const v = voucherInput.parse(a.payload);
      const invoice = a.kind === "rechnung_erstellen";
      const r = invoice ? await createInvoice(invoiceBody(v), v.festschreiben) : await createQuotation(quotationBody(v), v.festschreiben);
      const kind = invoice ? "invoices" : "quotations";
      const type = invoice ? "invoice" : "quotation";
      result = `${invoice ? "Rechnung" : "Angebot"} ${v.festschreiben ? "festgeschrieben" : "als Entwurf angelegt"}.`;
      links = [
        { label: "In Lexware öffnen", url: permalink(kind, r.id, v.festschreiben ? "view" : "edit") },
        ...(v.festschreiben ? [{ label: "PDF", url: `/api/lexware/pdf/${type}/${r.id}` }] : []),
      ];
    } else if (a.kind === "mail_senden") {
      const m = mailInput.parse(a.payload);
      await sendMail({ to: m.an, cc: m.cc, subject: m.betreff, text: m.text, inReplyTo: m.antwortAuf ?? null, references: m.referenzen });
      result = `E-Mail an ${m.an} gesendet.`;
      links = [{ label: "Postfach", url: "/mail" }];
    } else throw new Error("Unbekannte Aktion.");
    await db.pendingAction.update({ where: { id }, data: { result, links } });
    await appendNote(a.chatId, `✓ Freigegeben und erledigt: ${result} ${links.map((l) => `[${l.label}](${l.url})`).join(" · ")}`);
    return { ok: true as const, result, links };
  } catch (e) {
    const msg = e instanceof LexwareError || e instanceof MailError ? e.message : e instanceof Error ? e.message : "Unbekannter Fehler.";
    console.error("[aktion]", a.kind, e);
    await db.pendingAction.update({ where: { id }, data: { status: "ERROR", result: msg } });
    await appendNote(a.chatId, `✗ Die freigegebene Aktion ist fehlgeschlagen: ${msg}`);
    return { ok: false as const, error: msg };
  }
}

export async function declineAction(id: string, userId: string) {
  const r = await db.pendingAction.updateMany({ where: { id, status: "PENDING" }, data: { status: "DECLINED", decidedBy: userId, decidedAt: new Date() } });
  if (r.count) {
    const a = await db.pendingAction.findUnique({ where: { id }, select: { chatId: true, summary: true } });
    if (a) await appendNote(a.chatId, `Abgelehnt (nicht ausgeführt): ${a.summary}`);
  }
  return r.count > 0;
}

/**
 * Ergebnis in den Verlauf schreiben, damit Jarvis in der nächsten Runde davon weiß.
 * Nur anhängen (nie bestehende Nachrichten ändern) – als Nutzer-Hinweis in eckigen Klammern.
 */
async function appendNote(chatId: string, text: string) {
  const chat = await db.chat.findUnique({ where: { id: chatId }, select: { messages: true } });
  if (!chat) return;
  const messages = Array.isArray(chat.messages) ? (chat.messages as unknown[]) : [];
  messages.push({ role: "user", content: `[Systemhinweis aus der App, nicht vom Nutzer getippt] ${text}` });
  messages.push({ role: "assistant", content: text });
  await db.chat.update({ where: { id: chatId }, data: { messages: messages as object[] } });
}
