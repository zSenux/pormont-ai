import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { formatDate, todayYmd } from "@/lib/berlin";
import { sendMail, MailError } from "@/lib/mail/client";
import { mailConfigured } from "@/lib/mail/config";
import { sendPush } from "@/lib/push";
import { bookConfig } from "./config";
import { BookError, docData, partyOf, readParty, ymdOf, type Actor } from "./docs";
import { computeTotals } from "./money";
import { renderDocPdf } from "./pdf";

// Auftragsbestätigung (AB) als PDF im Briefbogen und per Mail an den Kunden.
// Kein GoBD-Beleg: wird jedes Mal frisch aus Auftrag + Angebot erzeugt. Gesendet wird nur nach einem Klick
// (Auftragsseite) bzw. nach Freigabe der Jarvis-Karte „auftragsbestaetigung_senden“ – nie automatisch.

const fmt = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join(".") : null);

/** PDF der Auftragsbestätigung */
export async function confirmationPdf(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { customer: true, quote: { include: { customer: true, project: { select: { name: true } } } }, project: { select: { name: true, address: true } } } });
  if (!o) throw new BookError("Auftrag nicht gefunden.");
  const cfg = await bookConfig();
  const today = todayYmd();
  const base = o.quote ? await docData(o.quote, cfg) : null;
  const lines = base?.lines.length ? base.lines : [{ name: o.title, description: o.production ?? null, qty: 1, unit: "pauschal", price: o.valueCents / 100, discount: 0, taxRate: 19 as const }];
  const reverseCharge = base?.reverseCharge ?? false;
  const buyer = o.customer ? partyOf(o.customer) : base?.buyer ?? readParty({ name: o.project.name });
  const start = ymdOf(o.startDate);
  const due = ymdOf(o.dueDate);
  const period = start || due ? `${fmt(start) ?? "nach Absprache"} – ${fmt(due) ?? "nach Absprache"}` : null;
  const payment = cfg.paymentDays ? `Zahlung: ${cfg.paymentDays} Tage nach Rechnungsstellung ohne Abzug.` : "Zahlung: sofort nach Rechnungsstellung.";
  // Schlusstext: Bausteine aus dem Angebot (VOB/B, AGB …) bleiben, „gültig bis“ fällt weg
  const outro = [payment, base?.outro, "Sollte etwas von Ihrer Bestellung abweichen, geben Sie uns bitte innerhalb von 5 Werktagen Bescheid. Wir freuen uns auf die Zusammenarbeit."].filter(Boolean).join("\n\n");
  const pdf = await renderDocPdf(
    {
      kind: "ANGEBOT",
      invoiceType: "NORMAL",
      deductions: [],
      views: [],
      number: o.number,
      date: today,
      dueDate: null,
      title: o.title,
      intro: `vielen Dank für Ihren Auftrag${o.quote?.number ? ` auf Grundlage unseres Angebots ${o.quote.number} vom ${formatDate(o.quote.date)}` : ""}${o.customerRef ? ` (Ihr Zeichen: ${o.customerRef})` : ""}. Hiermit bestätigen wir Ihnen die Ausführung der folgenden Leistungen:`,
      outro,
      reverseCharge,
      lines,
      totals: computeTotals(lines, reverseCharge),
      buyer,
      preceding: null,
      projectName: o.project.address ? `${o.project.name} · ${o.project.address}` : o.project.name,
      config: cfg,
    },
    null,
    { quote: o.quote?.number ? `${o.quote.number} vom ${formatDate(o.quote.date)}` : null, period },
  );
  return { pdf: Buffer.from(pdf), order: o, filename: `Auftragsbestaetigung_${o.number}.pdf` };
}

/** Vorschlag für die Mail (Sie-Form) */
export async function defaultConfirmationMail(orderId: string, userName: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { customer: true, quote: { select: { number: true, address: true } } } });
  if (!o) throw new BookError("Auftrag nicht gefunden.");
  const party = o.customer ? partyOf(o.customer) : readParty(o.quote?.address);
  return {
    an: o.customer?.email ?? party.email ?? "",
    betreff: `Auftragsbestätigung ${o.number}${o.quote?.number ? ` zu Angebot ${o.quote.number}` : ""} – ${COMPANY.name}`,
    text: `${party.greeting || "Sehr geehrte Damen und Herren,"}\n\nvielen Dank für Ihren Auftrag „${o.title}“. Anbei erhalten Sie unsere Auftragsbestätigung ${o.number}${o.quote?.number ? ` zu unserem Angebot ${o.quote.number}` : ""}.\n\nBitte prüfen Sie die Angaben. Bei Abweichungen melden Sie sich bitte innerhalb von 5 Werktagen.\n\nMit freundlichen Grüßen\n${userName}\n${COMPANY.name}\n${COMPANY.street} · ${COMPANY.zip} ${COMPANY.city}\nTel. ${COMPANY.phone} · ${COMPANY.email}`,
  };
}

export const confirmationInput = z.object({
  an: z.string().trim().min(3).max(300),
  cc: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)),
  betreff: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(20000),
});

/** Auftragsbestätigung per Mail senden (nach Klick bzw. freigegebener Karte) */
export async function sendConfirmation(orderId: string, input: z.input<typeof confirmationInput>, user: Actor) {
  if (!mailConfigured()) throw new BookError("Das E-Mail-Postfach ist noch nicht verbunden (Einstellungen → Verbindungen).");
  const m = confirmationInput.parse(input);
  const { pdf, order, filename } = await confirmationPdf(orderId);
  try {
    await sendMail({ to: m.an, cc: m.cc, subject: m.betreff, text: m.text, attachments: [{ filename, content: pdf, contentType: "application/pdf" }] });
  } catch (e) {
    throw new BookError(e instanceof MailError ? e.message : "Senden fehlgeschlagen.");
  }
  await db.order.update({ where: { id: orderId }, data: { confirmationSentAt: new Date(), confirmationSentTo: m.an } });
  if (order.quoteId) await db.salesDocEvent.create({ data: { docId: order.quoteId, text: `Auftragsbestätigung ${order.number} gesendet an ${m.an}`, userName: user.name } });
  return { to: m.an, number: order.number };
}

/** Nach Angebotsannahme: Hinweis „Auftragsbestätigung bereit“ (Push an den, der angenommen hat). Sendet nichts. */
export async function offerConfirmation(orderId: string, userId: string | null | undefined) {
  const cfg = await bookConfig();
  if (!cfg.confirmOnAccept) return;
  const o = await db.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, title: true, confirmationSentAt: true, customer: { select: { name: true } } } });
  if (!o || o.confirmationSentAt) return;
  await sendPush({ title: "Auftragsbestätigung bereit", body: `${o.number} · ${o.customer?.name ?? o.title} – jetzt prüfen und an den Kunden senden`, url: `/auftraege/${o.id}#bestaetigung`, tag: `ab-${o.id}`, ...(userId ? { userId } : {}) });
}

/** Zeile für Listen/Jarvis */
export const confirmationState = (o: { confirmationSentAt: Date | null; confirmationSentTo: string | null }) => (o.confirmationSentAt ? `gesendet am ${formatDate(o.confirmationSentAt)} an ${o.confirmationSentTo}` : "noch nicht gesendet");

