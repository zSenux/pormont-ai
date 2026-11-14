import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { addDaysYmd, todayYmd } from "@/lib/berlin";
import { sendMail, MailError } from "@/lib/mail/client";
import { mailConfigured } from "@/lib/mail/config";
import { bookConfig } from "./config";
import { BookError, docData, readParty, ymdOf, isOverdue, type Actor } from "./docs";
import { fmtEuroCents } from "./money";
import { buildCii, xrechnungGaps } from "./xrechnung";
import { DUNNING_LABEL, renderDunningPdf } from "./pdf";
import { KIND_LABEL } from "./types";
import { berlinDateTime } from "@/lib/berlin";

// Versand von Belegen und Mahnungen per Mail. Läuft nur nach einem menschlichen Klick (Seite, mit Rückfrage)
// oder nach Freigabe einer Karte (Jarvis: beleg_senden / mahnung_senden). Anhänge kommen immer aus der Datenbank.

export const sendInput = z.object({
  an: z.string().trim().min(3).max(300),
  cc: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)),
  betreff: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(20000),
  /** zusätzlich XRechnung-XML anhängen (öffentliche Auftraggeber) */
  xml: z.boolean().default(false),
});
export type SendInput = z.infer<typeof sendInput>;

const fmtDate = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join(".") : "");

/** Vorschlag für Betreff und Text (Sie-Form) */
export async function defaultDocMail(docId: string, userName: string) {
  const d = await db.salesDoc.findUnique({ where: { id: docId }, include: { customer: true } });
  if (!d) throw new BookError("Beleg nicht gefunden.");
  const party = readParty(d.address);
  const label = KIND_LABEL[d.kind];
  const greet = party.greeting || "Sehr geehrte Damen und Herren,";
  const body =
    d.kind === "ANGEBOT"
      ? `anbei erhalten Sie unser Angebot ${d.number}${d.title ? ` („${d.title}“)` : ""}. Es ist gültig bis zum ${fmtDate(ymdOf(d.dueDate))}.\n\nBei Fragen sind wir gerne für Sie da. Wir freuen uns auf Ihren Auftrag.`
      : d.kind === "RECHNUNG"
        ? `anbei erhalten Sie unsere Rechnung ${d.number} über ${fmtEuroCents(d.grossCents)}${d.dueDate ? `, zahlbar bis zum ${fmtDate(ymdOf(d.dueDate))}` : ""}.\n\nDie PDF-Datei enthält die E-Rechnung (ZUGFeRD) und kann direkt in Ihre Buchhaltung übernommen werden.\n\nVielen Dank für Ihren Auftrag.`
        : `anbei erhalten Sie unsere Gutschrift ${d.number} über ${fmtEuroCents(d.grossCents)}.`;
  return {
    an: d.customer?.email ?? party.email ?? "",
    betreff: `${label} ${d.number ?? ""} – ${COMPANY.name}`.replace(/\s+/g, " "),
    text: `${greet}\n\n${body}\n\nMit freundlichen Grüßen\n${userName}\n${COMPANY.name}\n${COMPANY.street} · ${COMPANY.zip} ${COMPANY.city}\nTel. ${COMPANY.phone} · ${COMPANY.email}`,
    xml: Boolean(party.buyerReference),
  };
}

/** Beleg per Mail senden (PDF mit E-Rechnung, optional XRechnung-XML) */
export async function sendDoc(docId: string, input: SendInput, user: Actor) {
  if (!mailConfigured()) throw new BookError("Das E-Mail-Postfach ist noch nicht verbunden (Einstellungen → Verbindungen).");
  const m = sendInput.parse(input);
  const d = await db.salesDoc.findUnique({ where: { id: docId } });
  if (!d) throw new BookError("Beleg nicht gefunden.");
  if (d.status === "ENTWURF" || !d.number || !d.pdf) throw new BookError("Bitte den Beleg zuerst festschreiben – Entwürfe werden nicht verschickt.");
  const attachments = [{ filename: `${KIND_LABEL[d.kind]}_${d.number}.pdf`, content: Buffer.from(d.pdf), contentType: "application/pdf" }];
  if (m.xml && d.kind !== "ANGEBOT" && !d.imported) {
    const data = await docData(d);
    const gaps = xrechnungGaps(data);
    if (gaps.length) throw new BookError(`Für die XRechnung fehlt: ${gaps.join(", ")}.`);
    attachments.push({ filename: `XRechnung_${d.number}.xml`, content: Buffer.from(buildCii(data, "xrechnung"), "utf8"), contentType: "application/xml" });
  }
  try {
    await sendMail({ to: m.an, cc: m.cc, subject: m.betreff, text: m.text, attachments });
  } catch (e) {
    throw new BookError(e instanceof MailError ? e.message : "Senden fehlgeschlagen.");
  }
  await db.salesDoc.update({ where: { id: docId }, data: { sentAt: new Date(), sentTo: m.an } });
  await db.salesDocEvent.create({ data: { docId, text: `Per Mail gesendet an ${m.an}${m.cc ? ` (CC ${m.cc})` : ""}${attachments.length > 1 ? " mit XRechnung" : ""}`, userName: user.name } });
  return { to: m.an, number: d.number, kind: d.kind };
}

// ---------- Mahnwesen ----------

/** Nächste Mahnstufe für eine überfällige Rechnung (1 = Erinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung) */
export async function createDunning(docId: string, user: Actor) {
  const cfg = await bookConfig();
  const d = await db.salesDoc.findUnique({ where: { id: docId } });
  if (!d || d.kind !== "RECHNUNG" || !d.number) throw new BookError("Rechnung nicht gefunden.");
  if (d.status !== "OFFEN") throw new BookError("Nur offene Rechnungen können gemahnt werden.");
  if (!isOverdue(d)) throw new BookError("Die Rechnung ist noch nicht fällig.");
  const level = Math.min(d.dunningLevel + 1, 3);
  const fee = level === 2 ? cfg.dunningFee1 : level === 3 ? cfg.dunningFee2 : 0;
  const today = todayYmd();
  const due = addDaysYmd(today, cfg.dunningDays);
  const feeCents = Math.round(fee * 100);
  const openCents = d.grossCents - d.paidCents;
  const pdf = Buffer.from(
    await renderDunningPdf({
      level,
      date: today,
      dueDate: due,
      buyer: readParty(d.address),
      invoice: { number: d.number, date: ymdOf(d.date)!, dueDate: ymdOf(d.dueDate), grossCents: d.grossCents, paidCents: d.paidCents },
      feeCents,
      config: cfg,
    }),
  );
  // Atomar: nur wenn die Stufe noch stimmt (Doppelklick legt keine zweite Mahnung an)
  const claim = await db.salesDoc.updateMany({ where: { id: docId, dunningLevel: d.dunningLevel, status: "OFFEN" }, data: { dunningLevel: level, dunnedAt: new Date() } });
  if (!claim.count) throw new BookError("Die Mahnung wurde gerade schon erstellt.");
  const dn = await db.dunning.create({ data: { docId, level, day: berlinDateTime(today), openCents, feeCents, dueDate: berlinDateTime(due), pdf, userName: user.name } });
  await db.salesDocEvent.create({ data: { docId, text: `${DUNNING_LABEL[level]} erstellt (offen ${fmtEuroCents(openCents)}${feeCents ? ` + ${fmtEuroCents(feeCents)} Gebühr` : ""}, neue Frist ${fmtDate(due)})`, userName: user.name } });
  return dn;
}

export async function defaultDunningMail(dunningId: string, userName: string) {
  const dn = await db.dunning.findUnique({ where: { id: dunningId }, include: { doc: { include: { customer: true } } } });
  if (!dn) throw new BookError("Mahnung nicht gefunden.");
  const party = readParty(dn.doc.address);
  const label = DUNNING_LABEL[dn.level];
  return {
    an: dn.doc.customer?.email ?? party.email ?? "",
    betreff: `${label} – Rechnung ${dn.doc.number} – ${COMPANY.name}`,
    text: `${party.greeting || "Sehr geehrte Damen und Herren,"}\n\n${dn.level === 1 ? "anbei unsere freundliche Zahlungserinnerung" : `anbei unsere ${label}`} zur Rechnung ${dn.doc.number}. Offen sind ${fmtEuroCents(dn.openCents + dn.feeCents)}, bitte bis zum ${fmtDate(ymdOf(dn.dueDate))}.\n\nSollten Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.\n\nMit freundlichen Grüßen\n${userName}\n${COMPANY.name}\nTel. ${COMPANY.phone} · ${COMPANY.email}`,
  };
}

export async function sendDunning(dunningId: string, input: Omit<SendInput, "xml">, user: Actor) {
  if (!mailConfigured()) throw new BookError("Das E-Mail-Postfach ist noch nicht verbunden (Einstellungen → Verbindungen).");
  const m = sendInput.omit({ xml: true }).parse(input);
  const dn = await db.dunning.findUnique({ where: { id: dunningId }, include: { doc: { select: { id: true, number: true, pdf: true } } } });
  if (!dn) throw new BookError("Mahnung nicht gefunden.");
  const attachments = [{ filename: `${DUNNING_LABEL[dn.level].replace(/[ .]/g, "")}_${dn.doc.number}.pdf`, content: Buffer.from(dn.pdf), contentType: "application/pdf" }];
  if (dn.doc.pdf) attachments.push({ filename: `Rechnung_${dn.doc.number}.pdf`, content: Buffer.from(dn.doc.pdf), contentType: "application/pdf" });
  try {
    await sendMail({ to: m.an, cc: m.cc, subject: m.betreff, text: m.text, attachments });
  } catch (e) {
    throw new BookError(e instanceof MailError ? e.message : "Senden fehlgeschlagen.");
  }
  await db.dunning.update({ where: { id: dunningId }, data: { sentAt: new Date(), sentTo: m.an } });
  await db.salesDocEvent.create({ data: { docId: dn.doc.id, text: `${DUNNING_LABEL[dn.level]} per Mail gesendet an ${m.an}`, userName: user.name } });
  return { to: m.an, number: dn.doc.number, label: DUNNING_LABEL[dn.level] };
}
