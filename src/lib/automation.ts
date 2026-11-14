import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { PHASES } from "@/lib/phases-shared";

const phaseTitle = (key: string) => PHASES.find((p) => p.key === key)?.title ?? key;

// EPS-Automatisierungen:
// - Termin überschritten → Push an den Verantwortlichen (Aufgaben, Meilensteine, Phasen, Fertigung, Aufträge, Montagen)
// - Wiedervorlage fällig → Push an den Zuständigen (Kundenakte)
// - Projekt abgeschlossen → Nachkalkulation erstellen und Projektleiter benachrichtigen

/** Atomar „einmal“ – true, wenn dieser Aufruf den Schlüssel als Erster gesetzt hat */
async function once(key: string) {
  try {
    await db.jobState.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch {
    return false;
  }
}

type Late = { key: string; users: (string | null | undefined)[]; text: string; url: string };

/** Alles, was heute überfällig ist (Termin vor heute bzw. Uhrzeit vorbei) */
export async function lateItems(now = new Date()): Promise<Late[]> {
  const today = berlinDateTime(todayYmd());
  const ymd = (d: Date) => berlinParts(d).ymd;
  const open = { status: { not: "FERTIG" as const } };
  const [tasks, milestones, phases, jobs, orders, assemblies] = await Promise.all([
    db.task.findMany({ where: { doneAt: null, OR: [{ dueHasTime: true, dueAt: { lt: now } }, { dueHasTime: false, dueAt: { lt: today } }] }, take: 200, select: { id: true, title: true, dueAt: true, assigneeId: true, createdById: true, project: { select: { id: true, name: true, leaderId: true } } } }),
    db.projectMilestone.findMany({ where: { doneAt: null, dueDate: { lt: today }, project: open }, take: 200, include: { project: { select: { id: true, name: true, leaderId: true } } } }),
    db.projectPhase.findMany({ where: { status: { in: ["OFFEN", "LAEUFT"] }, endDate: { lt: today }, project: open }, take: 200, include: { project: { select: { id: true, name: true, leaderId: true } } } }),
    db.productionJob.findMany({ where: { status: { notIn: ["FERTIG", "MONTAGEBEREIT"] }, plannedEnd: { lt: today } }, take: 200, include: { project: { select: { name: true, leaderId: true } } } }),
    db.order.findMany({ where: { status: { in: ["NEU", "IN_ARBEIT"] }, dueDate: { lt: today } }, take: 200, include: { project: { select: { leaderId: true } } } }),
    db.assembly.findMany({ where: { status: "GEPLANT", startAt: { lt: today } }, take: 200, include: { project: { select: { name: true, leaderId: true } } } }),
  ]);
  return [
    ...tasks.map((t) => ({ key: `task:${t.id}:${ymd(t.dueAt!)}`, users: [t.assigneeId ?? t.project?.leaderId ?? t.createdById], text: `Aufgabe „${t.title}“${t.project ? ` (${t.project.name})` : ""} war fällig am ${formatDate(t.dueAt)}`, url: t.project ? `/projekte/${t.project.id}` : "/aufgaben" })),
    ...milestones.map((m) => ({ key: `ms:${m.id}:${ymd(m.dueDate!)}`, users: [m.project.leaderId], text: `Meilenstein „${m.title}“ (${m.project.name}) war am ${formatDate(m.dueDate)}`, url: `/projekte/${m.project.id}` })),
    ...phases.map((p) => ({ key: `phase:${p.id}:${ymd(p.endDate!)}`, users: [p.project.leaderId], text: `Phase ${phaseTitle(p.key)} (${p.project.name}) sollte am ${formatDate(p.endDate)} fertig sein`, url: `/projekte/${p.project.id}` })),
    ...jobs.map((j) => ({ key: `fa:${j.id}:${ymd(j.plannedEnd!)}`, users: [j.assigneeId, j.project.leaderId], text: `Fertigung ${j.number} „${j.title}“ (${j.project.name}) sollte am ${formatDate(j.plannedEnd)} fertig sein`, url: `/fertigung/${j.id}` })),
    ...orders.map((o) => ({ key: `au:${o.id}:${ymd(o.dueDate!)}`, users: [o.project.leaderId], text: `Auftrag ${o.number} „${o.title}“ – Fertigstellung war am ${formatDate(o.dueDate)}`, url: `/auftraege/${o.id}` })),
    ...assemblies.map((a) => ({ key: `mo:${a.id}:${ymd(a.startAt)}`, users: [a.leaderId, a.project.leaderId], text: `Montage ${a.number} „${a.title}“ (${a.project.name}) war am ${formatDate(a.startAt)} geplant und ist nicht gestartet`, url: `/montage/${a.id}` })),
  ];
}

/** Pushes gebündelt je Empfänger (ohne Empfänger → an alle) */
async function pushGrouped(items: { users: (string | null | undefined)[]; text: string; url: string }[], one: string, many: (n: number) => string, tag: string, fallbackUrl: string) {
  const byUser = new Map<string, typeof items>();
  for (const it of items) {
    const targets = [...new Set(it.users.filter((u): u is string => Boolean(u)))];
    for (const u of targets.length ? targets : [""]) byUser.set(u, [...(byUser.get(u) ?? []), it]);
  }
  for (const [userId, list] of byUser) {
    const msg = list.length === 1 ? { title: one, body: list[0].text, url: list[0].url } : { title: many(list.length), body: list.slice(0, 3).map((x) => x.text).join(" · "), url: fallbackUrl };
    await sendPush({ ...msg, tag, ...(userId ? { userId } : {}) });
  }
}

/** Termin überschritten → benachrichtigen (je Sache und Termin einmal), werktags 7–18 Uhr */
export async function lateDeadlines() {
  const p = berlinParts();
  if (["Sat", "Sun"].includes(p.weekday) || p.h < 7 || p.h >= 18) return;
  const items = await lateItems();
  const fresh = [];
  for (const it of items) if (await once(`late:${it.key}`)) fresh.push(it);
  // Beim allerersten Lauf nur den Bestand merken, nicht alles auf einmal melden
  if (await once("late:init")) return;
  if (fresh.length) await pushGrouped(fresh, "⚠️ Termin überschritten", (n) => `⚠️ ${n} Termine überschritten`, "late", "/");
}

/** Wiedervorlagen der Kundenakte am fälligen Tag ab 8 Uhr melden (je Eintrag einmal, atomar) */
export async function followUpReminders() {
  const p = berlinParts();
  if (p.h < 8 || p.h >= 19) return;
  const due = await db.customerNote.findMany({
    where: { followUpDone: null, reminderSentAt: null, followUpAt: { lte: new Date(), gte: new Date(Date.now() - 7 * 86400_000) } },
    take: 50,
    include: { customer: { select: { id: true, name: true } } },
  });
  const sent = [];
  for (const n of due) {
    const r = await db.customerNote.updateMany({ where: { id: n.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (r.count) sent.push({ users: [n.assigneeId], text: `${n.customer.name}: ${n.text.length > 90 ? `${n.text.slice(0, 90)}…` : n.text}`, url: `/buchhaltung/kunden/${n.customer.id}` });
  }
  if (sent.length) await pushGrouped(sent, "📌 Wiedervorlage", (n) => `📌 ${n} Wiedervorlagen`, "wiedervorlage", "/");
}

/**
 * Projekt abgeschlossen → Nachkalkulation: Ergebnis als Projektnotiz festhalten und Projektleiter benachrichtigen.
 * Nur beim Wechsel auf FERTIG aufrufen (Aufrufer prüft den alten Status).
 * Fehler blockieren nie den Abschluss.
 */
export async function onProjectClosed(projectId: string, userName: string) {
  try {
    const p = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, status: true, leaderId: true, updatedAt: true } });
    if (!p || p.status !== "FERTIG") return;
    const { calcProject } = await import("@/lib/nachkalkulation");
    const c = await calcProject(projectId);
    const e = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
    const h = (c.minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const result = c.margin !== null ? `Ergebnis ${e(c.margin)} (${c.marginPct!.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %)` : "Ergebnis offen – Auftragswert fehlt";
    const text = `Nachkalkulation (automatisch) beim Abschluss: Auftragswert ${c.revenue !== null ? e(c.revenue) : "–"}, Kosten ${e(c.total)} (Lohn ${h} Std. = ${e(c.labor)}, Material ${e(c.material)}, Lieferanten ${e(c.supplier)}, Spesen ${e(c.spesen)}, Sonstiges ${e(c.extra)}). ${result}.`;
    await db.projectNote.create({ data: { projectId, text, authorName: `${userName} (Automatik)` } });
    await sendPush({ title: c.margin !== null && c.margin < 0 ? "📉 Projekt abgeschlossen – Verlust" : "✅ Projekt abgeschlossen", body: `${p.name}: ${result}. Nachkalkulation prüfen.`, url: `/projekte/${projectId}/nachkalkulation`, tag: `nachkalk-${projectId}`, ...(p.leaderId ? { userId: p.leaderId } : {}) });
  } catch (e) {
    console.error("[nachkalkulation]", e);
  }
}
