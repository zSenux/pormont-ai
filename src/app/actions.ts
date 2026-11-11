"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { endSession, requireAdmin, requireUser, startSession } from "@/lib/auth/user";
import { declineAction, executeAction } from "@/lib/jarvis/actions";
import { sendPush } from "@/lib/push";
import { berlinDateTime } from "@/lib/berlin";

// ---------- Anmeldung ----------

const attempts = new Map<string, { n: number; until: number }>();
async function ipKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "lokal";
}

const loginInput = z.object({ email: z.email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(200), weiter: z.string().optional() });

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const key = await ipKey();
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." };
  const parsed = loginInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Bitte E-Mail und Passwort eingeben." };
  const { email, password, weiter } = parsed.data;

  let user = await db.user.findUnique({ where: { email } });
  // Erster Start: Administrator aus ADMIN_EMAIL/ADMIN_PASSWORD anlegen, solange es noch niemanden gibt
  if (!user && (await db.user.count()) === 0 && process.env.ADMIN_EMAIL?.toLowerCase() === email && process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD === password) {
    user = await db.user.create({ data: { email, name: process.env.ADMIN_NAME || "Administrator", role: "ADMIN", passwordHash: await hashPassword(password) } });
  }
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    return { error: "E-Mail oder Passwort stimmt nicht." };
  }
  attempts.delete(key);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user.id, user.sessionVersion);
  redirect(weiter && /^\/(?!\/)/.test(weiter) ? weiter : "/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function logoutEverywhere() {
  const u = await requireUser();
  await db.user.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } });
  await endSession();
  redirect("/login");
}

export async function changePassword(_prev: { ok?: string; error?: string } | undefined, form: FormData): Promise<{ ok?: string; error?: string }> {
  const u = await requireUser();
  const p = z.object({ alt: z.string().min(1), neu: z.string().min(10, "Mindestens 10 Zeichen.").max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ungültig." };
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  if (!(await verifyPassword(p.data.alt, row.passwordHash))) return { error: "Altes Passwort stimmt nicht." };
  const updated = await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(p.data.neu), sessionVersion: { increment: 1 } } });
  await startSession(u.id, updated.sessionVersion);
  return { ok: "Passwort geändert. Andere Geräte wurden abgemeldet." };
}

// ---------- Team (nur Administratoren) ----------

export async function addUser(_prev: { ok?: string; error?: string } | undefined, form: FormData): Promise<{ ok?: string; error?: string }> {
  await requireAdmin();
  const p = z
    .object({ name: z.string().trim().min(2).max(80), email: z.email().transform((s) => s.toLowerCase()), password: z.string().min(10, "Passwort: mindestens 10 Zeichen.").max(200), role: z.enum(["ADMIN", "MEMBER"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ungültig." };
  if (await db.user.findUnique({ where: { email: p.data.email } })) return { error: "Diese E-Mail gibt es schon." };
  await db.user.create({ data: { name: p.data.name, email: p.data.email, role: p.data.role, passwordHash: await hashPassword(p.data.password) } });
  revalidatePath("/einstellungen");
  return { ok: `${p.data.name} angelegt. Bitte das Passwort sicher weitergeben.` };
}

export async function removeUser(id: string) {
  const admin = await requireAdmin();
  if (id === admin.id) return;
  await db.user.delete({ where: { id } }).catch(() => {});
  revalidatePath("/einstellungen");
}

// ---------- Freigaben ----------

export async function approveAction(id: string) {
  const u = await requireUser();
  const r = await executeAction(z.cuid().parse(id), u.id);
  revalidatePath("/belege");
  return r;
}

export async function rejectAction(id: string) {
  const u = await requireUser();
  return { ok: await declineAction(z.cuid().parse(id), u.id) };
}

// ---------- Aufgaben ----------

export async function addTask(form: FormData) {
  const u = await requireUser();
  const p = z.object({ title: z.string().trim().min(1).max(300), date: z.string().optional(), time: z.string().optional() }).parse(Object.fromEntries(form));
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
  const time = p.time && /^\d{2}:\d{2}$/.test(p.time) ? p.time : null;
  await db.task.create({ data: { title: p.title, dueAt: date ? berlinDateTime(date, time ?? "00:00") : null, dueHasTime: Boolean(date && time), createdById: u.id } });
  revalidatePath("/aufgaben");
  revalidatePath("/");
}

export async function toggleTask(id: string) {
  await requireUser();
  const t = await db.task.findUnique({ where: { id } });
  if (!t) return;
  await db.task.update({ where: { id }, data: { doneAt: t.doneAt ? null : new Date() } });
  revalidatePath("/aufgaben");
  revalidatePath("/");
}

export async function deleteTask(id: string) {
  await requireUser();
  await db.task.delete({ where: { id } }).catch(() => {});
  revalidatePath("/aufgaben");
}

// ---------- Gedächtnis ----------

export async function deleteMemory(id: string) {
  await requireUser();
  await db.memory.delete({ where: { id } }).catch(() => {});
  revalidatePath("/einstellungen");
}

// ---------- Push ----------

const subInput = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) }) });

export async function savePushSubscription(sub: unknown, device: string) {
  const u = await requireUser();
  const s = subInput.parse(sub);
  await db.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { userId: u.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, device: device.slice(0, 60) },
    update: { userId: u.id, p256dh: s.keys.p256dh, auth: s.keys.auth, device: device.slice(0, 60) },
  });
}

export async function removePushSubscription(endpoint: string) {
  const u = await requireUser();
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: u.id } });
}

export async function sendTestPush() {
  const u = await requireUser();
  return { sent: await sendPush({ title: "Jarvis", body: "Benachrichtigungen funktionieren ✓", url: "/", userId: u.id, tag: "test" }) };
}

export async function markMail(uid: number, seen: boolean) {
  await requireUser();
  const u = z.number().int().positive().parse(uid);
  const { setFlag } = await import("@/lib/mail/client");
  await setFlag(u, "\\Seen", seen);
  revalidatePath("/mail");
}
