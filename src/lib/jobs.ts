import "server-only";
import { db } from "@/lib/db";
import { berlinParts, formatDate, formatDateTime } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { customerName, openInvoices } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { mailConfigured } from "@/lib/mail/config";
import { mailsSince } from "@/lib/mail/client";
import { timeHm, todayEvents } from "@/lib/calendar";
import { readLicense } from "@/lib/license";
import { followUpReminders, lateDeadlines } from "@/lib/automation";
import { dailyTenders } from "@/lib/ausschreibungen";
import { warrantyReminders } from "@/lib/maengel";
import { expiringNuDocs } from "@/lib/nachunternehmer";
import { expiringEmployeeDocs } from "@/lib/personal";
import { dunningProposals } from "@/lib/buchhaltung/mahnwesen";
import { bookConfig } from "@/lib/buchhaltung/config";
import { monthCostEur } from "@/lib/ki-kosten";

async function pushAdmins(msg: { title: string; body: string; url: string; tag: string }) {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  for (const a of admins) await sendPush({ ...msg, userId: a.id });
}

/** Ablaufwarnung Personalakte + Nachunternehmer-Nachweise: werktags ab 8 Uhr, je Eintrag und Stufe (30 Tage / abgelaufen) einmal, gebündelt an die Admins */
async function expiryWarnings() {
  const p = berlinParts();
  if (["Sat", "Sun"].includes(p.weekday) || p.h < 8 || p.h >= 18) return;
  const [emp, nu] = await Promise.all([expiringEmployeeDocs(), expiringNuDocs()]);
  const fresh: { text: string; url: string }[] = [];
  for (const d of emp) {
    const stage = d.due.getTime() + 86400_000 <= Date.now() ? "ab" : "30";
    if (await once(`ablauf:pers:${d.id}:${d.due.toISOString().slice(0, 10)}:${stage}`)) fresh.push({ text: `${d.user.name}: ${d.title}${stage === "ab" ? " abgelaufen" : ` bis ${formatDate(d.due)}`}`, url: `/personal/${d.user.id}` });
  }
  for (const d of nu) {
    if (!d.validUntil) continue;
    const stage = d.validUntil.getTime() + 86400_000 <= Date.now() ? "ab" : "30";
    if (await once(`ablauf:nu:${d.id}:${d.validUntil.toISOString().slice(0, 10)}:${stage}`)) fresh.push({ text: `${d.subcontractor.name}: Nachweis${stage === "ab" ? " abgelaufen" : ` bis ${formatDate(d.validUntil)}`}`, url: `/nachunternehmer/${d.subcontractor.id}` });
  }
  if (fresh.length === 1) await pushAdmins({ title: "⏳ Läuft ab", body: fresh[0].text, url: fresh[0].url, tag: "ablauf" });
  else if (fresh.length > 1) await pushAdmins({ title: `⏳ ${fresh.length} Nachweise laufen ab`, body: fresh.slice(0, 3).map((f) => f.text).join(" · "), url: emp.length ? "/personal" : "/nachunternehmer", tag: "ablauf" });
}

/** Mahnvorschläge: werktags ab 9 Uhr einmal am Tag Push an die Admins – gesendet wird nichts */
async function dunningReminder() {
  const p = berlinParts();
  if (["Sat", "Sun"].includes(p.weekday) || p.h < 9 || p.h >= 17) return;
  if (!(await bookConfig()).autoDunning) return;
  const { due } = await dunningProposals();
  if (!due.length || !(await once(`mahnvorschlag:${p.ymd}`))) return;
  const sum = due.reduce((t, x) => t + x.open, 0);
  await pushAdmins({ title: `💶 ${due.length} ${due.length === 1 ? "Mahnung wartet" : "Mahnungen warten"} auf Freigabe`, body: `Zusammen ${fmtEuroCents(sum)} – u. a. ${due.slice(0, 2).map((x) => customerName(x.doc)).join(", ")}. Gesendet wird erst nach deiner Freigabe.`, url: "/buchhaltung/mahnwesen", tag: "mahnwesen" });
}

/** KI-Budget: je Monat einmal bei 80 % und einmal bei 100 % des Budgets Push an die Admins */
async function kiBudget() {
  const { eur, cfg } = await monthCostEur();
  if (!cfg.budgetEur) return;
  const month = berlinParts().ymd.slice(0, 7);
  const stage = eur >= cfg.budgetEur ? 100 : eur >= cfg.budgetEur * 0.8 ? 80 : 0;
  if (!stage || !(await once(`ki-budget:${month}:${stage}`))) return;
  const fmt = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  await pushAdmins({ title: stage === 100 ? "🤖 KI-Budget erreicht" : "🤖 KI-Budget zu 80 % verbraucht", body: `Diesen Monat ca. ${fmt(eur)} von ${fmt(cfg.budgetEur)}. Jarvis läuft weiter – Details unter KI-Kosten.`, url: "/ki-kosten", tag: "ki-budget" });
}

// Hintergrund-Jobs im App-Prozess (wie in Klaic OS): Erinnerungen und Warnungen aus der Buchhaltung per Push.
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
  if (["Sat", "Sun"].includes(p.weekday) || p.h < 8 || p.h >= 18) return;
  const { overdue: list } = await openInvoices();
  const fresh = [];
  for (const v of list) if (await once(`overdue:${v.id}`)) fresh.push(v);
  const url = "/buchhaltung/belege?art=rechnungen&status=ueberfaellig";
  // Beim allerersten Lauf nur den Bestand merken, nicht alles auf einmal melden
  if (!(await once("overdue:init"))) {
    if (fresh.length === 1) {
      const v = fresh[0];
      await sendPush({ title: "💶 Rechnung überfällig", body: `${v.number} · ${customerName(v)} · ${fmtEuroCents(v.grossCents - v.paidCents)} (fällig ${formatDate(v.dueDate)})`, url: `/buchhaltung/beleg/${v.id}`, tag: "overdue" });
    } else if (fresh.length > 1) {
      const sum = fresh.reduce((s, v) => s + v.grossCents - v.paidCents, 0);
      await sendPush({ title: `💶 ${fresh.length} Rechnungen überfällig`, body: `Zusammen ${fmtEuroCents(sum)} – u. a. ${fresh.slice(0, 2).map(customerName).join(", ")}`, url, tag: "overdue" });
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
  const open = await openInvoices().catch(() => null);
  if (open?.overdue.length) money = ` · ${open.overdue.length} überfällige Rechnungen (${fmtEuroCents(open.overdueCents)})`;
  await sendPush({ title: "☀️ Guten Morgen – Jarvis", body: `${tasks} Aufgaben für heute${termine}${money}. Tippen für den Überblick.`, url: "/jarvis?q=Was%20steht%20heute%20an%3F", tag: "briefing" });
}

/** Push bei neuen (ungelesenen) Mails im Posteingang – merkt sich die höchste UID */
async function newMails() {
  if (!mailConfigured()) return;
  const state = await db.jobState.findUnique({ where: { key: "mail:last" } });
  const last = state ? (JSON.parse(state.value) as { uid: number | string; validity: string }) : null;
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
  // Ohne Freischaltung durch Klaic Media laufen keine Jobs (keine Push-Nachrichten, keine Buchhaltungs-/Mail-Abfragen)
  // Je Job nur ein Lauf gleichzeitig: hängt z. B. der Mailserver, stapeln sich sonst alle 2 Minuten neue
  // Verbindungen und Speicher, bis der Server stehen bleibt. Nach 10 Minuten gibt der Wächter den Job wieder frei.
  const running = new Set<string>();
  const safe = (name: string, fn: () => Promise<unknown>) => () => {
    if (running.has(name)) {
      console.warn(`[job ${name}] läuft noch – Durchgang übersprungen`);
      return;
    }
    running.add(name);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[job ${name}] nach 10 Minuten ohne Ende – wird freigegeben`);
        resolve();
      }, 10 * 60_000);
    });
    Promise.race([readLicense().then((s) => (s.ok ? fn() : undefined)), limit])
      .catch((e) => console.error(`[job ${name}]`, e))
      .finally(() => {
        clearTimeout(timer);
        running.delete(name);
      });
  };
  setInterval(safe("aufgaben", taskReminders), 60_000);
  setInterval(safe("termine", eventReminders), 60_000);
  setInterval(safe("briefing", morningBriefing), 60_000);
  setInterval(safe("rechnungen", overdueInvoices), 30 * 60_000);
  setTimeout(safe("rechnungen", overdueInvoices), 20_000);
  setInterval(safe("mail", newMails), 2 * 60_000);
  // EPS: Termin überschritten → benachrichtigen, Wiedervorlagen der Kundenakte
  setInterval(safe("fristen", lateDeadlines), 30 * 60_000);
  setTimeout(safe("fristen", lateDeadlines), 40_000);
  setInterval(safe("wiedervorlagen", followUpReminders), 10 * 60_000);
  // Ablaufwarnungen (Personalakte, Nachunternehmer) und Mahnvorschläge
  setInterval(safe("ablauf", expiryWarnings), 30 * 60_000);
  setTimeout(safe("ablauf", expiryWarnings), 50_000);
  setInterval(safe("mahnwesen", dunningReminder), 30 * 60_000);
  setTimeout(safe("mail", newMails), 15_000);
  // Ausschreibungen werktags ab 6 Uhr (einmal am Tag), Gewährleistung läuft ab (einmal je Projekt)
  setInterval(safe("ausschreibungen", () => dailyTenders(once)), 15 * 60_000);
  setTimeout(safe("ausschreibungen", () => dailyTenders(once)), 60_000);
  setInterval(safe("gewaehrleistung", () => warrantyReminders(once)), 6 * 3600_000);
  setTimeout(safe("gewaehrleistung", () => warrantyReminders(once)), 90_000);
  setInterval(safe("ki-budget", kiBudget), 30 * 60_000);
  setTimeout(safe("ki-budget", kiBudget), 70_000);
  console.log("[jobs] gestartet");
}
