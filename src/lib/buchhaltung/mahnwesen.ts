import "server-only";
import { db } from "@/lib/db";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/berlin";
import { bookConfig } from "./config";
import { BookError, customerName, openCentsOf, ymdOf, type Actor } from "./docs";
import { fmtEuroCents } from "./money";
import { DUNNING_LABEL } from "./pdf";
import { createDunning, defaultDunningMail, sendDunning } from "./send";

// Automatische Mahnstufen: Jarvis rechnet aus, welche Rechnung heute die nächste Stufe braucht
// (Erinnerung X Tage nach Fälligkeit, 1./2. Mahnung Y Tage nach Ablauf der letzten Mahnfrist) und schlägt sie vor.
// Gesendet wird NIE automatisch: erst wenn ein Administrator (Chef) auf „Freigeben“ klickt (Seite /buchhaltung/mahnwesen)
// bzw. eine Freigabe-Karte mahnung_senden bestätigt. Der Job meldet nur per Push, dass Vorschläge warten.

export type ProposalState = "faellig" | "ungesendet" | "bald" | "pausiert" | "gesperrt" | "ausgereizt" | "klein";
export const PROPOSAL_LABEL: Record<ProposalState, string> = {
  faellig: "Jetzt fällig",
  ungesendet: "Erstellt, noch nicht gesendet",
  bald: "Demnächst",
  pausiert: "Zurückgestellt",
  gesperrt: "Kunde wird nicht gemahnt",
  ausgereizt: "2. Mahnung abgelaufen",
  klein: "Kleinbetrag",
};

/** Alle offenen Rechnungen mit Mahn-Zustand und nächster Stufe */
export async function dunningProposals() {
  const cfg = await bookConfig();
  const today = todayYmd();
  const soon = addDaysYmd(today, 7);
  const docs = await db.salesDoc.findMany({
    where: { kind: "RECHNUNG", status: "OFFEN", dueDate: { not: null } },
    orderBy: { dueDate: "asc" },
    include: { customer: { select: { id: true, name: true, email: true, noDunning: true } }, dunnings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, level: true, day: true, dueDate: true, sentAt: true, sentTo: true } } },
  });
  const out = [];
  for (const d of docs) {
    const open = openCentsOf(d);
    if (open <= 0) continue;
    const last = d.dunnings[0] ?? null;
    const level = d.dunningLevel;
    const base = level === 0 ? ymdOf(d.dueDate)! : ymdOf(last?.dueDate ?? d.dunnedAt ?? d.dueDate)!;
    const nextDue = addDaysYmd(base, level === 0 ? cfg.reminderAfterDays : cfg.nextLevelAfterDays);
    const paused = d.dunningPausedUntil && ymdOf(d.dunningPausedUntil)! > today;
    let state: ProposalState | null;
    if (last && !last.sentAt && last.level === level) state = "ungesendet";
    else if (d.customer?.noDunning) state = "gesperrt";
    else if (paused) state = "pausiert";
    else if (open < cfg.dunningMinEuro * 100) state = nextDue <= today ? "klein" : null;
    else if (level >= 3) state = nextDue <= today ? "ausgereizt" : null;
    else if (nextDue <= today) state = "faellig";
    else if (nextDue <= soon) state = "bald";
    else state = null;
    if (!state) continue;
    const nextLevel = state === "ungesendet" ? level : Math.min(level + 1, 3);
    const overdueDays = Math.max(0, Math.round((Date.parse(today) - Date.parse(ymdOf(d.dueDate)!)) / 86400_000));
    out.push({ doc: d, open, level, nextLevel, nextDue, state, last, overdueDays, email: d.customer?.email ?? null });
  }
  return { cfg, items: out, due: out.filter((x) => x.state === "faellig" || x.state === "ungesendet") };
}

export type Proposal = Awaited<ReturnType<typeof dunningProposals>>["items"][number];

/**
 * Freigabe durch den Chef: nächste Stufe erstellen und per Mail senden (mode „mail“) bzw. nur als PDF für die Post.
 * Ist die Mahnung schon erstellt aber nicht gesendet, wird diese gesendet. Nur Administratoren.
 */
export async function releaseDunning(docId: string, mode: "mail" | "post", actor: Actor & { role: string }) {
  if (actor.role !== "ADMIN") throw new BookError("Mahnungen gibt nur die Geschäftsführung (Administrator) frei.");
  const { items } = await dunningProposals();
  const p = items.find((x) => x.doc.id === docId);
  if (!p || !["faellig", "ungesendet", "bald", "pausiert", "gesperrt"].includes(p.state)) throw new BookError("Für diese Rechnung steht gerade keine Mahnung an.");
  const dn = p.state === "ungesendet" && p.last ? { id: p.last.id, level: p.last.level } : await createDunning(docId, actor);
  if (dn.level > 0 && p.doc.dunningPausedUntil) await db.salesDoc.update({ where: { id: docId }, data: { dunningPausedUntil: null, dunningPauseNote: null } });
  const label = DUNNING_LABEL[dn.level];
  if (mode === "post") return { dunningId: dn.id, text: `${label} zu ${p.doc.number} erstellt – PDF drucken und per Post senden.` };
  const m = await defaultDunningMail(dn.id, actor.name);
  if (!m.an) return { dunningId: dn.id, text: `${label} zu ${p.doc.number} erstellt, aber beim Kunden fehlt die E-Mail-Adresse – bitte per Post senden.` };
  try {
    const r = await sendDunning(dn.id, { an: m.an, betreff: m.betreff, text: m.text }, actor);
    return { dunningId: dn.id, text: `${r.label} zu ${r.number} gesendet an ${r.to}.` };
  } catch (e) {
    if (e instanceof BookError) return { dunningId: dn.id, text: `${label} zu ${p.doc.number} erstellt, Senden fehlgeschlagen: ${e.message}` };
    throw e;
  }
}

/** Mahnung zurückstellen (z. B. Kunde hat Zahlung zugesagt) */
export async function pauseDunning(docId: string, days: number, note: string | null, actor: Actor) {
  const until = addDaysYmd(todayYmd(), Math.max(1, Math.min(90, Math.round(days))));
  const d = await db.salesDoc.update({ where: { id: docId }, data: { dunningPausedUntil: new Date(`${until}T12:00:00Z`), dunningPauseNote: note } });
  await db.salesDocEvent.create({ data: { docId, text: `Mahnung zurückgestellt bis ${formatDate(new Date(`${until}T12:00:00Z`))}${note ? ` – ${note}` : ""}`, userName: actor.name } });
  return d;
}

export async function setCustomerNoDunning(customerId: string, noDunning: boolean) {
  return db.customer.update({ where: { id: customerId }, data: { noDunning } });
}

export function proposalLine(p: Proposal) {
  const action = p.state === "ungesendet" ? `${DUNNING_LABEL[p.level]} senden` : p.state === "ausgereizt" ? "Inkasso/gerichtliches Mahnverfahren prüfen" : `nächste Stufe: ${DUNNING_LABEL[p.nextLevel]}`;
  return `- ${p.doc.number} · ${customerName(p.doc)} · offen ${fmtEuroCents(p.open)} · ${p.overdueDays} Tage überfällig · ${PROPOSAL_LABEL[p.state]}${p.state === "bald" ? ` (ab ${formatDate(new Date(`${p.nextDue}T12:00:00Z`))})` : ""} → ${action}${p.email ? "" : " · keine E-Mail beim Kunden"} · id ${p.doc.id}`;
}
