import "server-only";
import { db } from "@/lib/db";
import { berlinParts, formatDate, formatDateTime, formatEuro } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { lexwareConfigured } from "@/lib/lexware/client";
import { voucherListAll } from "@/lib/lexware/api";
import { mailConfigured } from "@/lib/mail/config";
import { mailsSince } from "@/lib/mail/client";
import { timeHm, todayEvents } from "@/lib/calendar";

// Hintergrund-Jobs im App-Prozess (wie in Klaic OS): Erinnerungen und Lexware-Warnungen per Push.
// Läuft nur in Produktion bzw. lokal mit JOBS=1.

/** Atomar „einmal“ – true, wenn dieser Lauf den Schlüssel als Erster gesetzt hat */
async function once(key: string, value = "1") {
  try {
    await db.jobState.create({ data: { key, value } });
    return true;
  } catch {
    return false;
  }
}

async function taskReminders() {
  const due = await db.task.findMany({ where: { doneAt: null, dueHasTime: true, reminderSentAt: null, dueAt: { lte: new Date(), gte: new Date(Date.now() - 6 * 3600_000) } }, take: 20 });
  for (const t of due) {
    const r = await db.task.updateMany({ where: { id: t.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (!r.count) continue;
    await sendPush({ title: "⏰ Erinnerung", body: `${t.title} (${formatDateTime(t.dueAt)})`, url: "/aufgaben", tag: `task-${t.id}` });
  }
}

/** Termin-Erinnerung remindMinutes vorher (je Termin einmal, atomar) */
async function eventReminders() {
  const now = Date.now();
  const soon = await db.event.findMany({ where: { allDay: false, reminderSentAt: null, remindMinutes: { not: null }, startAt: { gte: new Date(now - 10 * 60_000), lte: new Date(now + 24 * 3600_000) } }, take: 50 });
  for (const e of soon) {
    if (e.startAt.getTime() - (e.remindMinutes ?? 0) * 60_000 > now) continue;
    const r = await db.event.updateMany({ where: { id: e.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (!r.count) continue;
    await sendPush({ title: `📅 ${timeHm(e.startAt)} ${e.title}`, body: e.location ? `Ort: ${e.location}` : `In ${Math.max(0, Math.round((e.startAt.getTime() - now) / 60_000))} Minuten`, url: "/kalender", tag: `event-${e.id}` });
  }
}

/** Neu überfällige Rechnungen melden (je Rechnung einmal), werktags 8–18 Uhr */
async function overdueInvoices() {
  const p = berlinParts();
  if (!lexwareConfigured() || ["Sat", "Sun"].includes(p.weekday) || p.h < 8 || p.h >= 18) return;
  const list = await voucherListAll({ type: "invoice", status: "overdue" });
  const fresh = [];
  for (const v of list) if (await once(`overdue:${v.id}`)) fresh.push(v);
  // Beim allerersten Lauf nur den Bestand merken, nicht alles auf einmal melden
  if (!(await once("overdue:init"))) {
    if (fresh.length === 1) {
      const v = fresh[0];
      await sendPush({ title: "💶 Rechnung überfällig", body: `${v.voucherNumber} · ${v.contactName} · ${formatEuro(v.openAmount ?? v.totalAmount)} (fällig ${formatDate(v.dueDate)})`, url: "/belege?status=ueberfaellig", tag: "overdue" });
    } else if (fresh.length > 1) {
      const sum = fresh.reduce((s, v) => s + (v.openAmount ?? v.totalAmount ?? 0), 0);
      await sendPush({ title: `💶 ${fresh.length} Rechnungen überfällig`, body: `Zusammen ${formatEuro(sum)} – u. a. ${fresh.slice(0, 2).map((v) => v.contactName).join(", ")}`, url: "/belege?status=ueberfaellig", tag: "overdue" });
    }
  }
}

/** Morgen-Briefing werktags um 7:30 als Push (Kurzfassung, Details in der App) */
async function morningBriefing() {
  const p = berlinParts();
  if (["Sat", "Sun"].includes(p.weekday) || p.h !== 7 || p.min < 30) return;
  if (!(await once(`briefing:${p.ymd}`))) return;
  const tasks = await db.task.count({ where: { doneAt: null, dueAt: { lte: new Date(Date.now() + 18 * 3600_000) } } });
  const events = await todayEvents();
  const first = events.find((e) => !e.allDay);
  const termine = events.length ? ` · ${events.length} ${events.length === 1 ? "Termin" : "Termine"}${first ? ` (erster ${timeHm(first.startAt)} ${first.title})` : ""}` : "";
  let money = "";
  if (lexwareConfigured()) {
    const overdue = await voucherListAll({ type: "invoice", status: "overdue" }).catch(() => []);
    if (overdue.length) money = ` · ${overdue.length} überfällige Rechnungen (${formatEuro(overdue.reduce((s, v) => s + (v.openAmount ?? 0), 0))})`;
  }
  await sendPush({ title: "☀️ Guten Morgen – Jarvis", body: `${tasks} Aufgaben für heute${termine}${money}. Tippen für den Überblick.`, url: "/jarvis?q=Was%20steht%20heute%20an%3F", tag: "briefing" });
}

/** Push bei neuen (ungelesenen) Mails im Posteingang – merkt sich die höchste UID */
async function newMails() {
  if (!mailConfigured()) return;
  const state = await db.jobState.findUnique({ where: { key: "mail:last" } });
  const last = state ? (JSON.parse(state.value) as { uid: number; validity: string }) : null;
  const r = await mailsSince(last);
  await db.jobState.upsert({ where: { key: "mail:last" }, create: { key: "mail:last", value: JSON.stringify({ uid: r.maxUid, validity: r.validity }) }, update: { value: JSON.stringify({ uid: r.maxUid, validity: r.validity }) } });
  const fresh = r.mails.filter((m) => !m.seen);
  if (fresh.length === 1) {
    const m = fresh[0];
    await sendPush({ title: `✉️ ${m.from}`, body: m.subject, url: `/mail/${m.uid}`, tag: "mail" });
  } else if (fresh.length > 1) {
    await sendPush({ title: `✉️ ${fresh.length} neue Mails`, body: fresh.slice(0, 3).map((m) => `${m.from}: ${m.subject}`).join(" · "), url: "/mail?filter=ungelesen", tag: "mail" });
  }
}

let started = false;
export function startJobs() {
  if (started) return;
  started = true;
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => console.error(`[job ${name}]`, e));
  setInterval(safe("aufgaben", taskReminders), 60_000);
  setInterval(safe("termine", eventReminders), 60_000);
  setInterval(safe("briefing", morningBriefing), 60_000);
  setInterval(safe("lexware", overdueInvoices), 30 * 60_000);
  setTimeout(safe("lexware", overdueInvoices), 20_000);
  setInterval(safe("mail", newMails), 2 * 60_000);
  setTimeout(safe("mail", newMails), 15_000);
  console.log("[jobs] gestartet");
}
