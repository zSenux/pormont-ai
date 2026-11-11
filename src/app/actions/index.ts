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
import { createHash, timingSafeEqual } from "node:crypto";
import { clearSetupCode, saveSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";

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

const setupInput = z.object({
  code: z.string().trim().min(4).max(40),
  name: z.string().trim().min(2, "Bitte deinen Namen eingeben.").max(80),
  email: z.email("Bitte eine gültige E-Mail eingeben.").transform((s) => s.toLowerCase()),
  password: z.string().min(10, "Passwort: mindestens 10 Zeichen.").max(200),
});

/** Ersteinrichtung: ersten Administrator anlegen – nur solange es noch keinen Benutzer gibt und mit Einrichtungs-Code */
export async function setupAdmin(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const key = await ipKey();
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." };
  const p = setupInput.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Bitte alle Felder ausfüllen." };
  const expected = process.env.SETUP_CODE;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!expected || !timingSafeEqual(Buffer.from(createHash("sha256").update(norm(p.data.code)).digest()), Buffer.from(createHash("sha256").update(norm(expected)).digest()))) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    return { error: "Der Einrichtungs-Code stimmt nicht." };
  }
  const user = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return null;
    return tx.user.create({ data: { email: p.data.email, name: p.data.name, role: "ADMIN", passwordHash: await hashPassword(p.data.password) } });
  });
  if (!user) return { error: "Jarvis ist schon eingerichtet. Bitte normal anmelden." };
  attempts.delete(key);
  await clearSetupCode();
  await startSession(user.id, user.sessionVersion);
  redirect("/einstellungen?willkommen=1#verbindungen");
}

// ---------- Verbindungen (Schlüssel, Postfach) – nur Administratoren ----------

const optional = z.string().max(2000).optional();
const connectionInput = z.object({
  ANTHROPIC_API_KEY: optional,
  LEXWARE_API_KEY: optional,
  GOOGLE_PLACES_API_KEY: optional,
  MAIL_PROVIDER: z.enum(["strato", "gmx", "ionos", "custom"]).optional(),
  MAIL_USER: z.union([z.literal(""), z.email("Bitte eine gültige E-Mail-Adresse für das Postfach eingeben.")]).optional(),
  MAIL_PASSWORD: optional,
  MAIL_FROM_NAME: z.string().max(80).optional(),
  MAIL_IMAP_HOST: z.string().max(200).optional(),
  MAIL_IMAP_PORT: z.union([z.literal(""), z.string().regex(/^\d{2,5}$/)]).optional(),
  MAIL_SMTP_HOST: z.string().max(200).optional(),
  MAIL_SMTP_PORT: z.union([z.literal(""), z.string().regex(/^\d{2,5}$/)]).optional(),
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_NUMBER: z.union([z.literal(""), z.string().trim().regex(/^\+?[\d ()/-]{6,20}$/, "Bitte die Twilio-Nummer im Format +49 … eingeben.")]).optional(),
  clear: z.string().optional(),
});

export async function saveConnections(_prev: { ok?: string; error?: string } | undefined, form: FormData): Promise<{ ok?: string; error?: string }> {
  await requireAdmin();
  const p = connectionInput.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingabe ungültig." };
  const { clear, MAIL_PROVIDER, ...rest } = p.data;
  const values: Parameters<typeof saveSettings>[0] = { ...rest };
  if (MAIL_PROVIDER) {
    values.MAIL_PROVIDER = MAIL_PROVIDER;
    if (MAIL_PROVIDER !== "custom") Object.assign(values, { MAIL_IMAP_HOST: null, MAIL_IMAP_PORT: null, MAIL_SMTP_HOST: null, MAIL_SMTP_PORT: null });
  }
  const removable = ["ANTHROPIC_API_KEY", "LEXWARE_API_KEY", "GOOGLE_PLACES_API_KEY", "MAIL_PASSWORD", "TWILIO_AUTH_TOKEN"] as const;
  for (const k of removable) if (clear === k) values[k] = null;
  if (clear === "MAIL") Object.assign(values, { MAIL_USER: null, MAIL_PASSWORD: null });
  await saveSettings(values);
  revalidatePath("/", "layout");
  return { ok: clear ? "Entfernt." : "Gespeichert. Die Verbindungen werden unten neu geprüft." };
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

// ---------- Telefon-Jarvis (eigene Nummer + PIN) ----------

export async function savePhoneAccess(_prev: { ok?: string; error?: string } | undefined, form: FormData): Promise<{ ok?: string; error?: string }> {
  const u = await requireUser();
  if (form.get("remove") === "1") {
    await db.user.update({ where: { id: u.id }, data: { phone: null, phonePinHash: null } });
    revalidatePath("/einstellungen");
    return { ok: "Telefonzugang entfernt." };
  }
  const p = z.object({ phone: z.string().trim().min(6).max(30), pin: z.union([z.literal(""), z.string().regex(/^\d{6,8}$/, "PIN: 6 bis 8 Ziffern.")]) }).safeParse({ phone: form.get("phone") ?? "", pin: form.get("pin") ?? "" });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Eingabe prüfen." };
  const phone = normalizePhone(p.data.phone);
  if (!phone) return { error: "Bitte eine gültige Handynummer eingeben, z. B. 0171 1234567." };
  if (/^(\d)\1+$/.test(p.data.pin) || "0123456789".includes(p.data.pin) || "9876543210".includes(p.data.pin)) if (p.data.pin) return { error: "Bitte keine einfache PIN wie 111111 oder 123456." };
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { phonePinHash: true } });
  if (!p.data.pin && !row.phonePinHash) return { error: "Bitte eine PIN festlegen." };
  const other = await db.user.findFirst({ where: { phone, NOT: { id: u.id } }, select: { id: true } });
  if (other) return { error: "Diese Nummer gehört schon zu einem anderen Benutzer." };
  await db.user.update({ where: { id: u.id }, data: { phone, ...(p.data.pin ? { phonePinHash: await hashPassword(p.data.pin) } : {}) } });
  revalidatePath("/einstellungen");
  return { ok: `Gespeichert. Jarvis erkennt dich an ${phone}.` };
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
