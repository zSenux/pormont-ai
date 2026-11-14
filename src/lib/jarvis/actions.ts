import "server-only";
import { db } from "@/lib/db";
import { formatEuro } from "@/lib/berlin";
import { LexwareError, permalink } from "@/lib/lexware/client";
import { createContact, createInvoice, createQuotation } from "@/lib/lexware/api";
import { sendMail, MailError } from "@/lib/mail/client";
import { mailInput } from "@/lib/mail/input";
import { z } from "zod";
import { receiptSummary, receiptData, uploadReceipt } from "@/lib/receipts";
import { LEXWARE_APP } from "@/lib/lexware/client";
import { sendRequest, SupplierError } from "@/lib/suppliers";
import { contactBody, contactInput, invoiceBody, quotationBody, totals, voucherInput } from "@/lib/lexware/payloads";
import { BookError, cancelInvoice, customerName, finalizeDoc } from "@/lib/buchhaltung/docs";
import { createDunning, defaultDocMail, defaultDunningMail, sendDoc, sendDunning } from "@/lib/buchhaltung/send";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { KIND_LABEL } from "@/lib/buchhaltung/types";
import { DUNNING_LABEL } from "@/lib/buchhaltung/pdf";

// Festschreiben, Versand, Mahnung und Storno der Buchhaltung sowie Mails laufen NIE direkt aus dem Chat: Jarvis legt eine PendingAction an,
// das Team sieht eine Freigabe-Karte und erst „Freigeben“ führt sie aus (atomar, nur einmal).

// kunde_anlegen/rechnung_erstellen/angebot_erstellen = alte Lexware-Karten (nur noch für bestehende Karten)
export const ACTION_KINDS = ["kunde_anlegen", "rechnung_erstellen", "angebot_erstellen", "mail_senden", "beleg_hochladen", "preisanfrage_senden", "beleg_festschreiben", "beleg_senden", "mahnung_senden", "beleg_stornieren"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type ActionLink = { label: string; url: string };

const anfrageInput = z.object({ requestId: z.cuid(), an: z.string().max(300), betreff: z.string().max(300), text: z.string().max(20000) });
const belegInput = z.object({ fileId: z.string().min(1).max(40), text: z.string().max(300) });
const docRef = z.object({ docId: z.string().min(5).max(40) });
const docSend = docRef.extend({ an: z.string().trim().max(300).optional(), cc: z.string().trim().max(300).optional(), betreff: z.string().trim().max(300).optional(), text: z.string().trim().max(20000).optional(), xml: z.boolean().default(false) });
const dunSend = docRef.extend({ an: z.string().trim().max(300).optional() });

async function loadDoc(docId: string) {
  const d = await db.salesDoc.findUnique({ where: { id: docId }, include: { customer: { select: { name: true, email: true } } } });
  if (!d) throw new BookError("Beleg nicht gefunden.");
  return d;
}
const docTitle = (d: Awaited<ReturnType<typeof loadDoc>>) => `${KIND_LABEL[d.kind]} ${d.number ?? "(Entwurf)"} für ${customerName(d)} über ${fmtEuroCents(d.grossCents)} brutto`;

async function actorOf(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } });
  return { id: u.id, name: u.name };
}

/** Für die Freigabe-Karte: Belegdaten aus der Datenbank lesen (nie vom Modell übernehmen) */
export async function receiptActionInput(fileId: string) {
  const f = await db.storedFile.findUnique({ where: { id: fileId }, select: { id: true, kind: true, name: true, meta: true, lexFileId: true } });
  if (!f || f.kind !== "beleg") throw new Error("Belegfoto nicht gefunden.");
  if (f.lexFileId) throw new Error("Dieser Beleg ist schon in Lexware.");
  const d = receiptData.safeParse(f.meta);
  return { fileId: f.id, text: (d.success ? receiptSummary(d.data) : null) ?? f.name };
}

/** Prüft die Eingabe und baut den Text für die Freigabe-Karte */
export async function describe(kind: ActionKind, input: unknown): Promise<{ summary: string; payload: unknown }> {
  if (kind === "beleg_festschreiben" || kind === "beleg_stornieren") {
    const { docId } = docRef.parse(input);
    const d = await loadDoc(docId);
    if (kind === "beleg_festschreiben") {
      if (d.status !== "ENTWURF") throw new BookError("Der Beleg ist schon festgeschrieben.");
      return { summary: `${docTitle(d)} festschreiben – bekommt eine Nummer und ist danach nicht mehr änderbar.`, payload: { docId } };
    }
    if (d.kind !== "RECHNUNG" || d.status === "ENTWURF" || d.status === "STORNIERT") throw new BookError("Stornieren geht nur bei festgeschriebenen, nicht stornierten Rechnungen.");
    return { summary: `${docTitle(d)} stornieren – dazu wird eine Storno-Gutschrift über den vollen Betrag festgeschrieben.`, payload: { docId } };
  }
  if (kind === "beleg_senden") {
    const m = docSend.parse(input);
    const d = await loadDoc(m.docId);
    if (d.kind === "GUTSCHRIFT" && d.status === "ENTWURF") throw new BookError("Gutschriften entstehen nur per Storno.");
    if (d.status === "STORNIERT") throw new BookError("Die Rechnung ist storniert und wird nicht mehr verschickt.");
    const an = m.an || d.customer?.email;
    if (!an) throw new BookError("Keine E-Mail-Adresse beim Kunden – bitte Empfänger angeben.");
    const payload = { docId: m.docId, an, cc: m.cc || undefined, betreff: m.betreff || undefined, text: m.text || undefined, xml: m.xml };
    return {
      summary: `${d.status === "ENTWURF" ? "Festschreiben (Nummer, danach unveränderlich) und " : ""}${docTitle(d)} per E-Mail senden an ${an}${m.cc ? ` (CC ${m.cc})` : ""}, PDF mit E-Rechnung${m.xml ? " + XRechnung-XML" : ""} im Anhang.\nBetreff: ${m.betreff || "Vorlage"}\n\n${m.text || "(Standardtext der Vorlage)"}`,
      payload,
    };
  }
  if (kind === "mahnung_senden") {
    const m = dunSend.parse(input);
    const d = await loadDoc(m.docId);
    if (d.kind !== "RECHNUNG" || d.status !== "OFFEN") throw new BookError("Nur offene Rechnungen können gemahnt werden.");
    const an = m.an || d.customer?.email;
    if (!an) throw new BookError("Keine E-Mail-Adresse beim Kunden – bitte Empfänger angeben.");
    const level = Math.min(d.dunningLevel + 1, 3);
    return { summary: `${DUNNING_LABEL[level]} zu ${docTitle(d)} (offen ${fmtEuroCents(d.grossCents - d.paidCents)}) erstellen und an ${an} senden (Vorlagentext, Mahnung + Rechnung als PDF).`, payload: { docId: m.docId, an } };
  }
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
  if (kind === "preisanfrage_senden") {
    const r = anfrageInput.parse(input);
    return { summary: `Preisanfrage senden an ${r.an}\nBetreff: ${r.betreff}\n\n${r.text}`, payload: { requestId: r.requestId } };
  }
  if (kind === "beleg_hochladen") {
    const b = belegInput.parse(input);
    return { summary: `Belegfoto an Lexware übergeben (unter Belege zum Verbuchen): ${b.text}`, payload: { fileId: b.fileId } };
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
  const { summary, payload } = await describe(kind, input);
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
    } else if (a.kind === "preisanfrage_senden") {
      const { requestId } = z.object({ requestId: z.cuid() }).parse(a.payload);
      const r = await sendRequest(requestId);
      result = `Preisanfrage an ${r.supplier} (${r.to}) gesendet.`;
      links = [{ label: "Anfrage", url: `/lieferanten/anfrage/${requestId}` }];
    } else if (a.kind === "beleg_hochladen") {
      const { fileId } = z.object({ fileId: z.string() }).parse(a.payload);
      await uploadReceipt(fileId);
      result = "Beleg an Lexware übergeben – er liegt dort unter Belege zum Verbuchen.";
      links = [{ label: "Belege in Lexware", url: `${LEXWARE_APP}/vouchers` }, { label: "Belegfotos", url: "/belege/foto" }];
    } else if (a.kind === "beleg_festschreiben") {
      const { docId } = docRef.parse(a.payload);
      const d = await finalizeDoc(docId, await actorOf(userId));
      result = `${KIND_LABEL[d.kind]} ${d.number} festgeschrieben.`;
      links = [{ label: "Beleg", url: `/buchhaltung/beleg/${docId}` }, { label: "PDF", url: `/api/buchhaltung/pdf/${docId}` }];
    } else if (a.kind === "beleg_stornieren") {
      const { docId } = docRef.parse(a.payload);
      const gs = await cancelInvoice(docId, await actorOf(userId));
      result = `Rechnung storniert, Storno-Gutschrift ${gs.number} festgeschrieben.`;
      links = [{ label: "Rechnung", url: `/buchhaltung/beleg/${docId}` }, { label: "Gutschrift", url: `/buchhaltung/beleg/${gs.creditId}` }];
    } else if (a.kind === "beleg_senden") {
      const m = docSend.parse(a.payload);
      const user = await actorOf(userId);
      const cur = await loadDoc(m.docId);
      if (cur.status === "ENTWURF") await finalizeDoc(m.docId, user);
      const def = await defaultDocMail(m.docId, user.name);
      await sendDoc(m.docId, { an: m.an ?? def.an, cc: m.cc, betreff: m.betreff || def.betreff, text: m.text || def.text, xml: m.xml }, user);
      const d = await loadDoc(m.docId);
      result = `${KIND_LABEL[d.kind]} ${d.number} an ${m.an ?? def.an} gesendet.`;
      links = [{ label: "Beleg", url: `/buchhaltung/beleg/${m.docId}` }, { label: "PDF", url: `/api/buchhaltung/pdf/${m.docId}` }];
    } else if (a.kind === "mahnung_senden") {
      const m = dunSend.parse(a.payload);
      const user = await actorOf(userId);
      const dn = await createDunning(m.docId, user);
      const def = await defaultDunningMail(dn.id, user.name);
      await sendDunning(dn.id, { an: m.an || def.an, betreff: def.betreff, text: def.text }, user);
      result = `${DUNNING_LABEL[dn.level]} an ${m.an || def.an} gesendet.`;
      links = [{ label: "Rechnung", url: `/buchhaltung/beleg/${m.docId}` }, { label: "Mahnung (PDF)", url: `/api/buchhaltung/mahnung/${dn.id}` }];
    } else throw new Error("Unbekannte Aktion.");
    await db.pendingAction.update({ where: { id }, data: { result, links } });
    await appendNote(a.chatId, `✓ Freigegeben und erledigt: ${result} ${links.map((l) => `[${l.label}](${l.url})`).join(" · ")}`);
    return { ok: true as const, result, links };
  } catch (e) {
    const msg = e instanceof LexwareError || e instanceof MailError || e instanceof SupplierError || e instanceof BookError ? e.message : e instanceof Error ? e.message : "Unbekannter Fehler.";
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
