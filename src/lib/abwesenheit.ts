import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { ABS_KIND_SHORT, ABS_STATUS_LABEL, fmtDays, workdaysBetween, type AbsKind, type AbsStatus } from "@/lib/abwesenheit-shared";

// Urlaub & Krank. Urlaub/Sonstiges: Antrag → Admin genehmigt/lehnt ab (atomar BEANTRAGT → …).
// Krankmeldung gilt sofort. Genehmigt → je Arbeitstag ein TimeEntry URLAUB/KRANK (Stundenliste, Lohn-CSV);
// Storno entfernt diese Einträge wieder. Admins tragen für andere direkt genehmigt ein.

export class AbsenceError extends Error {}
type Actor = { id: string; name: string; role: string };

const ymd = (d: Date) => berlinParts(d).ymd;
const dayMinutes = () => {
  const n = Number(process.env.SOLL_MINUTEN_TAG);
  return Number.isFinite(n) && n > 0 && n <= 720 ? Math.round(n) : 480;
};
export const defaultVacationDays = () => {
  const n = Number(process.env.URLAUB_TAGE);
  return Number.isFinite(n) && n > 0 && n <= 60 ? Math.round(n) : 30;
};

async function pushAdmins(title: string, body: string, url: string, tag: string, exceptId?: string) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  for (const a of admins) await sendPush({ title, body, url, tag, userId: a.id });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
async function bookTimes(tx: Tx, a: { id: string; userId: string; kind: string; from: Date; to: Date; halfDay: boolean }) {
  if (a.kind === "SONSTIGES") return; // Sonstiges zählt nicht als Urlaub/Krank in der Lohnliste
  const mins = a.halfDay ? Math.round(dayMinutes() / 2) : dayMinutes();
  const days = workdaysBetween(ymd(a.from), ymd(a.to));
  if (days.length) await tx.timeEntry.createMany({ data: days.map((d) => ({ userId: a.userId, day: berlinDateTime(d), minutes: mins, kind: a.kind, note: `${ABS_KIND_SHORT[a.kind as AbsKind]} (Abwesenheit)`, absenceId: a.id })) });
}

export async function requestAbsence(i: { userId: string; kind: AbsKind; from: string; to: string; halfDay?: boolean; note?: string | null; certificate?: boolean }, actor: Actor) {
  if (i.to < i.from) throw new AbsenceError("„Bis“ liegt vor „Von“.");
  if (i.userId !== actor.id && actor.role !== "ADMIN") throw new AbsenceError("Für andere eintragen dürfen nur Administratoren.");
  const span = (Date.parse(i.to) - Date.parse(i.from)) / 86400_000;
  if (span > 92) throw new AbsenceError("Höchstens 3 Monate am Stück eintragen.");
  const halfDay = Boolean(i.halfDay) && i.from === i.to;
  const wd = workdaysBetween(i.from, i.to).length;
  if (!wd) throw new AbsenceError("Im Zeitraum liegt kein Arbeitstag (Wochenende/Feiertag).");
  const days = halfDay ? 0.5 : wd;
  const user = await db.user.findUnique({ where: { id: i.userId }, select: { id: true, name: true } });
  if (!user) throw new AbsenceError("Mitarbeiter nicht gefunden.");
  const from = berlinDateTime(i.from), to = berlinDateTime(i.to);
  const direct = i.kind === "KRANK" || actor.role === "ADMIN";
  const a = await db.$transaction(async (tx) => {
    const clash = await tx.absence.findFirst({ where: { userId: i.userId, status: { in: ["BEANTRAGT", "GENEHMIGT"] }, from: { lte: to }, to: { gte: from } } });
    if (clash) throw new AbsenceError(`Überschneidet sich mit ${ABS_KIND_SHORT[clash.kind as AbsKind]} ${formatDate(clash.from)}–${formatDate(clash.to)}.`);
    const created = await tx.absence.create({
      data: { userId: i.userId, kind: i.kind, from, to, halfDay, days, note: i.note || null, certificate: Boolean(i.certificate), status: direct ? "GENEHMIGT" : "BEANTRAGT", createdBy: actor.name, ...(direct ? { decidedBy: actor.name, decidedAt: new Date() } : {}) },
    });
    if (direct) await bookTimes(tx, created);
    return created;
  });
  const when = i.from === i.to ? formatDate(from) : `${formatDate(from)}–${formatDate(to)}`;
  if (i.kind === "KRANK") await pushAdmins("🤒 Krankmeldung", `${user.name}: ${when} (${fmtDays(days)})`, "/abwesenheiten", `krank-${a.id}`, actor.id);
  else if (!direct) await pushAdmins("🏖️ Urlaubsantrag", `${user.name}: ${ABS_KIND_SHORT[i.kind]} ${when} (${fmtDays(days)})`, "/abwesenheiten", `antrag-${a.id}`);
  return a;
}

export async function decideAbsence(id: string, approve: boolean, note: string | null, actor: Actor) {
  if (actor.role !== "ADMIN") throw new AbsenceError("Genehmigen dürfen nur Administratoren.");
  const a = await db.$transaction(async (tx) => {
    const r = await tx.absence.updateMany({ where: { id, status: "BEANTRAGT" }, data: { status: approve ? "GENEHMIGT" : "ABGELEHNT", decidedBy: actor.name, decidedAt: new Date(), decisionNote: note || null } });
    if (!r.count) throw new AbsenceError("Der Antrag ist schon entschieden.");
    const x = await tx.absence.findUniqueOrThrow({ where: { id } });
    if (approve) await bookTimes(tx, x);
    return x;
  });
  const when = `${formatDate(a.from)}${a.to.getTime() !== a.from.getTime() ? `–${formatDate(a.to)}` : ""}`;
  await sendPush({ title: approve ? "✅ Urlaub genehmigt" : "❌ Urlaub abgelehnt", body: `${ABS_KIND_SHORT[a.kind as AbsKind]} ${when}${note ? ` – ${note}` : ""}`, url: "/abwesenheiten", tag: `antrag-${a.id}`, userId: a.userId });
  return a;
}

/** Eigene Anträge zurückziehen (genehmigter Urlaub nur, solange er nicht begonnen hat); Admin immer */
export async function cancelAbsence(id: string, actor: Actor) {
  const a = await db.absence.findUnique({ where: { id } });
  if (!a) throw new AbsenceError("Abwesenheit nicht gefunden.");
  const admin = actor.role === "ADMIN";
  if (!admin && a.userId !== actor.id) throw new AbsenceError("Nur eigene Einträge stornieren.");
  if (!admin && a.status === "GENEHMIGT" && a.kind !== "KRANK" && ymd(a.from) <= todayYmd()) throw new AbsenceError("Begonnenen Urlaub kann nur ein Administrator ändern.");
  await db.$transaction(async (tx) => {
    const r = await tx.absence.updateMany({ where: { id, status: { in: ["BEANTRAGT", "GENEHMIGT"] } }, data: { status: "STORNIERT", decidedBy: actor.name, decidedAt: new Date() } });
    if (!r.count) throw new AbsenceError("Schon storniert oder abgelehnt.");
    await tx.timeEntry.deleteMany({ where: { absenceId: id } });
  });
  if (a.userId !== actor.id) await sendPush({ title: "Abwesenheit storniert", body: `${ABS_KIND_SHORT[a.kind as AbsKind]} ${formatDate(a.from)}–${formatDate(a.to)} (von ${actor.name})`, url: "/abwesenheiten", tag: `antrag-${a.id}`, userId: a.userId });
}

/** Urlaubskonto eines Jahres: Anspruch, genommen/geplant (genehmigt), beantragt, Rest */
export async function vacationBalance(userId: string, year = Number(todayYmd().slice(0, 4))) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { vacationDays: true } });
  const start = berlinDateTime(`${year}-01-01`), end = berlinDateTime(`${year}-12-31`);
  const list = await db.absence.findMany({ where: { userId, kind: "URLAUB", status: { in: ["BEANTRAGT", "GENEHMIGT"] }, from: { lte: end }, to: { gte: start } } });
  // Jahresübergreifend: nur Arbeitstage im Jahr zählen
  const inYear = (a: (typeof list)[number]) => (a.halfDay ? 0.5 : workdaysBetween(ymd(a.from), ymd(a.to)).filter((d) => d.startsWith(String(year))).length);
  const approved = list.filter((a) => a.status === "GENEHMIGT").reduce((s, a) => s + inYear(a), 0);
  const requested = list.filter((a) => a.status === "BEANTRAGT").reduce((s, a) => s + inYear(a), 0);
  const entitlement = u.vacationDays ?? defaultVacationDays();
  return { year, entitlement, approved, requested, rest: entitlement - approved, restAfter: entitlement - approved - requested };
}

/** Abwesenheiten (genehmigt + beantragt), die den Zeitraum berühren */
export function absencesBetween(fromYmd: string, toYmd: string, opts: { userId?: string; approvedOnly?: boolean } = {}) {
  return db.absence.findMany({
    where: { status: { in: opts.approvedOnly ? ["GENEHMIGT"] : ["BEANTRAGT", "GENEHMIGT"] }, from: { lte: berlinDateTime(toYmd) }, to: { gte: berlinDateTime(fromYmd) }, ...(opts.userId ? { userId: opts.userId } : {}) },
    orderBy: { from: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });
}

export const absenceCovers = (a: { from: Date; to: Date }, day: string) => ymd(a.from) <= day && day <= ymd(a.to);

export function absenceLine(a: { id: string; kind: string; status: string; from: Date; to: Date; days: number; halfDay: boolean; note: string | null; user?: { name: string } | null }) {
  const when = a.from.getTime() === a.to.getTime() ? formatDate(a.from) : `${formatDate(a.from)}–${formatDate(a.to)}`;
  return `- ${a.user ? `${a.user.name}: ` : ""}${ABS_KIND_SHORT[a.kind as AbsKind]} ${when} (${a.halfDay ? "halber Tag" : fmtDays(a.days)}) · ${ABS_STATUS_LABEL[a.status as AbsStatus]}${a.note ? ` · „${a.note}“` : ""} · id ${a.id}`;
}
