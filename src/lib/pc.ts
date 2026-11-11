import "server-only";
import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { Prisma, type PcJobStatus } from "@/generated/prisma/client";

// Computer-Steuerung: Windows-PCs mit der Jarvis-App und Aufträge an sie (übernommen aus Klaic OS, Phase 80/114).
// Der PC meldet sich mit der Sitzung des angemeldeten Nutzers – kein eigener Geräteschlüssel nötig.

/** Ein PC gilt als erreichbar, wenn er sich in den letzten 60 s gemeldet hat */
export const ONLINE_MS = 60_000;
/** Aufträge, die so lange nicht abgeholt wurden, verfallen */
const QUEUE_MS = 10 * 60_000;
/** Live-Bild höchstens so lange am Stück */
export const VIEW_MS = 10 * 60_000;
/** Höchstzahl Schritte je Auftrag (Schutz vor Endlosschleifen) */
export const MAX_STEPS = 120;

export const OPEN: PcJobStatus[] = ["QUEUED", "RUNNING", "CONFIRM"];

export type PcLine = { at: string; text: string };

export class PcError extends Error {}

export function isOnline(d: { lastSeenAt: Date | null }) {
  return Boolean(d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_MS);
}

/** Gerät des Nutzers (sonst Fehler) */
export async function ownDevice(userId: string, deviceId: string) {
  const d = await db.pcDevice.findUnique({ where: { id: deviceId } });
  if (!d || d.userId !== userId) throw new PcError("PC nicht gefunden.");
  return d;
}

/** Auftrag des Nutzers (sonst Fehler) */
export async function ownJob(userId: string, jobId: string) {
  const j = await db.pcJob.findUnique({ where: { id: jobId } });
  if (!j || j.userId !== userId) throw new PcError("Auftrag nicht gefunden.");
  return j;
}

/** Lebenszeichen der App. Liefert den nächsten Auftrag (atomar übernommen), Live-Bild-Wunsch und abgebrochene Aufträge. */
export async function heartbeat(userId: string, b: { deviceId: string; name: string; remoteEnabled: boolean; status: Record<string, unknown>; busy: string[] }) {
  const existing = await db.pcDevice.findUnique({ where: { id: b.deviceId }, select: { userId: true } });
  if (existing && existing.userId !== userId) throw new PcError("Dieser PC gehört zu einem anderen Konto. Bitte in der App neu anmelden.");
  const now = new Date();
  const device = await db.pcDevice.upsert({
    where: { id: b.deviceId },
    create: { id: b.deviceId, userId, name: b.name, remoteEnabled: b.remoteEnabled, status: b.status as object, lastSeenAt: now },
    update: { name: b.name, remoteEnabled: b.remoteEnabled, status: b.status as object, lastSeenAt: now },
  });

  // Alte, nie abgeholte Aufträge verfallen lassen
  await db.pcJob.updateMany({ where: { deviceId: device.id, status: "QUEUED", createdAt: { lt: new Date(Date.now() - QUEUE_MS) } }, data: { status: "ERROR", reply: "Der PC hat den Auftrag nicht rechtzeitig abgeholt.", finishedAt: now } });

  // Nächster Auftrag: vom PC selbst immer, vom Handy nur mit erlaubter Fernsteuerung
  let job: { id: string; prompt: string; origin: string } | null = null;
  if (b.busy.length === 0) {
    const next = await db.pcJob.findFirst({
      where: { deviceId: device.id, status: "QUEUED", ...(b.remoteEnabled ? {} : { origin: "pc" }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, prompt: true, origin: true },
    });
    if (next) {
      const claimed = await db.pcJob.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING" } });
      if (claimed.count) job = next;
    }
  }
  // Aufträge, die der Nutzer inzwischen gestoppt hat
  const stopped = b.busy.length ? await db.pcJob.findMany({ where: { id: { in: b.busy.slice(0, 10) }, status: { notIn: OPEN } }, select: { id: true } }) : [];
  // Ausgeschaltete Fernsteuerung bricht laufende Aufträge vom Handy ab
  if (!b.remoteEnabled) await db.pcJob.updateMany({ where: { deviceId: device.id, origin: "remote", status: { in: ["QUEUED"] } }, data: { status: "CANCELED", reply: "Fernsteuerung am PC ausgeschaltet.", finishedAt: now } });

  const view = Boolean(b.remoteEnabled && device.viewUntil && device.viewUntil > now);
  if (!view && device.viewImage) await db.pcDevice.update({ where: { id: device.id }, data: { viewImage: null, viewUntil: null } });
  return { job, view, stopped: stopped.map((s) => s.id) };
}

/** Neuer Auftrag. Ohne deviceId: zuletzt gesehener PC des Nutzers. */
export async function createJob(userId: string, prompt: string, opts: { deviceId?: string | null; origin: "pc" | "remote" }) {
  const device = opts.deviceId
    ? await ownDevice(userId, opts.deviceId)
    : await db.pcDevice.findFirst({ where: { userId }, orderBy: { lastSeenAt: "desc" } });
  if (!device) throw new PcError("Noch kein PC verbunden. Installiere die Jarvis-App für Windows und melde dich dort an.");
  if (!isOnline(device)) throw new PcError(`${device.name} ist gerade nicht erreichbar (App nicht gestartet oder PC aus).`);
  if (opts.origin === "remote" && !device.remoteEnabled) throw new PcError(`Fernsteuerung ist an ${device.name} ausgeschaltet. Am PC im Jarvis-Symbol unten rechts „Fernsteuerung erlauben“ anhaken.`);
  const open = await db.pcJob.count({ where: { deviceId: device.id, status: { in: OPEN } } });
  if (open >= 3) throw new PcError("Am PC laufen schon Aufträge – bitte warten oder einen stoppen.");
  const chat = await db.chat.create({ data: { userId, source: "pc", title: `Am PC: ${prompt.slice(0, 70)}` } });
  return db.pcJob.create({ data: { deviceId: device.id, userId, chatId: chat.id, prompt: prompt.slice(0, 4000), origin: opts.origin } });
}

export async function addLine(jobId: string, text: string) {
  const line: PcLine = { at: new Date().toISOString(), text: text.slice(0, 300) };
  // jsonb anhängen ohne Lesen (mehrere Schreiber möglich)
  await db.$executeRaw`UPDATE "PcJob" SET "lines" = COALESCE("lines", '[]'::jsonb) || ${JSON.stringify([line])}::jsonb, "updatedAt" = now() WHERE "id" = ${jobId}`;
}

/** Rückfrage der App: wartet dann auf decide() */
export async function requestConfirm(job: { id: string; userId: string; origin: string; prompt: string }, text: string, detail: string) {
  const r = await db.pcJob.updateMany({ where: { id: job.id, status: { in: ["RUNNING", "CONFIRM"] } }, data: { status: "CONFIRM", confirm: { text: text.slice(0, 300), detail: detail.slice(0, 2000) }, decision: null } });
  if (!r.count) throw new PcError("Auftrag läuft nicht mehr.");
  await addLine(job.id, `Wartet auf Freigabe: ${text}`);
  if (job.origin === "remote") await sendPush({ userId: job.userId, title: "Jarvis am PC fragt", body: text.slice(0, 140), url: `/pc?auftrag=${job.id}`, tag: `pc-${job.id}` });
}

/** Entscheidung (Handy/Browser bzw. Dialog am PC) */
export async function decide(userId: string, jobId: string, yes: boolean) {
  await ownJob(userId, jobId);
  const r = await db.pcJob.updateMany({ where: { id: jobId, status: "CONFIRM" }, data: { status: "RUNNING", decision: yes ? "yes" : "no", confirm: Prisma.DbNull } });
  if (!r.count) throw new PcError("Keine offene Rückfrage.");
  await addLine(jobId, yes ? "Freigegeben." : "Abgelehnt.");
}

export async function cancelJob(userId: string, jobId: string, reason = "Gestoppt.") {
  await ownJob(userId, jobId);
  await db.pcJob.updateMany({ where: { id: jobId, status: { in: OPEN } }, data: { status: "CANCELED", reply: reason, finishedAt: new Date(), pending: Prisma.DbNull } });
}

export async function finishJob(jobId: string, status: "DONE" | "ERROR", reply: string) {
  await db.pcJob.updateMany({ where: { id: jobId, status: { in: OPEN } }, data: { status, reply: reply.slice(0, 8000), finishedAt: new Date(), confirm: Prisma.DbNull } });
  const j = await db.pcJob.findUnique({ where: { id: jobId }, select: { userId: true, origin: true, prompt: true } });
  if (j?.origin === "remote") await sendPush({ userId: j.userId, title: status === "DONE" ? "Jarvis am PC: fertig" : "Jarvis am PC: Problem", body: reply.slice(0, 140), url: `/pc?auftrag=${jobId}`, tag: `pc-${jobId}` });
}

/** Live-Bild an/aus (nur bei erlaubter Fernsteuerung) */
export async function setView(userId: string, deviceId: string, on: boolean) {
  const d = await ownDevice(userId, deviceId);
  if (on && !d.remoteEnabled) throw new PcError("Fernsteuerung ist an diesem PC ausgeschaltet.");
  if (on && !isOnline(d)) throw new PcError(`${d.name} ist gerade nicht erreichbar.`);
  await db.pcDevice.update({ where: { id: d.id }, data: on ? { viewUntil: new Date(Date.now() + VIEW_MS) } : { viewUntil: null, viewImage: null } });
}

/** Lage für die Seite /pc */
export async function pcState(userId: string) {
  const [devices, jobs] = await Promise.all([
    db.pcDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, select: { id: true, name: true, remoteEnabled: true, lastSeenAt: true, status: true, viewUntil: true, viewAt: true } }),
    db.pcJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, deviceId: true, chatId: true, prompt: true, origin: true, status: true, lines: true, reply: true, confirm: true, createdAt: true, finishedAt: true } }),
  ]);
  const now = Date.now();
  return {
    devices: devices.map((d) => ({ ...d, online: isOnline(d), viewing: Boolean(d.viewUntil && d.viewUntil.getTime() > now) })),
    jobs,
  };
}
