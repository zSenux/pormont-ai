import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as webpush from "web-push";
import { db } from "@/lib/db";

// Einstellungen, die der Kunde selbst in Jarvis einträgt (Einstellungen → Verbindungen) statt im Hosting-Panel.
// Werte liegen in AppSetting und werden beim Start (instrumentation.ts) und nach jedem Speichern in process.env
// gespiegelt – der übrige Code liest weiter process.env. Echte Umgebungsvariablen haben immer Vorrang.
// AUTH_SECRET und die VAPID-Schlüssel erzeugt Jarvis beim ersten Start selbst.

export const EDITABLE = ["ANTHROPIC_API_KEY", "LEXWARE_API_KEY", "GOOGLE_PLACES_API_KEY", "MAIL_PROVIDER", "MAIL_USER", "MAIL_PASSWORD", "MAIL_FROM_NAME", "MAIL_IMAP_HOST", "MAIL_IMAP_PORT", "MAIL_SMTP_HOST", "MAIL_SMTP_PORT"] as const;
export type EditableKey = (typeof EDITABLE)[number];
const SECRET = new Set<string>(["ANTHROPIC_API_KEY", "LEXWARE_API_KEY", "GOOGLE_PLACES_API_KEY", "MAIL_PASSWORD", "AUTH_SECRET", "VAPID_PRIVATE_KEY", "SETUP_CODE"]);
const AUTO = ["AUTH_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "SETUP_CODE"] as const;

type G = { __pmEnvKeys?: Set<string>; __pmSettingsLoaded?: Promise<void> };
const g = globalThis as G;
// Welche Schlüssel kamen aus der echten Umgebung? (einmal je Prozess, vor dem ersten Spiegeln)
const envKeys = (g.__pmEnvKeys ??= new Set(Object.keys(process.env).filter((k) => process.env[k])));

/** Kommt der Wert aus dem Hosting-Panel (dann in der Oberfläche nicht änderbar)? */
export const fromEnv = (key: string) => envKeys.has(key);

// Schlüssel für die Verschlüsselung: aus der Datenbank-Adresse abgeleitet → ein reiner Datenbank-Export enthält keine lesbaren Schlüssel.
// Ändert sich DATABASE_URL, sind gespeicherte Geheimnisse unlesbar und müssen neu eingetragen werden (Jarvis zeigt dann „fehlt“).
function cryptoKey() {
  return createHash("sha256").update(`promont-settings-v1|${process.env.SETTINGS_KEY || process.env.DATABASE_URL || ""}`).digest();
}
function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}
function decrypt(value: string) {
  const [v, iv, tag, ct] = value.split(":");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", cryptoKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function apply(key: string, value: string | null) {
  if (envKeys.has(key)) return;
  if (value) process.env[key] = value;
  else delete process.env[key];
}

async function store(key: string, value: string) {
  const v = SECRET.has(key) ? encrypt(value) : value;
  await db.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function load() {
  const rows = await db.appSetting.findMany();
  const have = new Map<string, string>();
  for (const r of rows) {
    const v = SECRET.has(r.key) ? decrypt(r.value) : r.value;
    if (v) have.set(r.key, v);
  }
  for (const k of EDITABLE) apply(k, have.get(k) ?? null);

  // Automatisch erzeugte Werte (nur wenn weder Umgebung noch Datenbank sie haben)
  const ensure = async (key: string, make: () => string) => {
    if (envKeys.has(key)) return;
    let v = have.get(key);
    if (!v) {
      v = make();
      await store(key, v);
    }
    apply(key, v);
  };
  await ensure("AUTH_SECRET", () => randomBytes(48).toString("base64url"));
  if (!envKeys.has("VAPID_PUBLIC_KEY") && !envKeys.has("VAPID_PRIVATE_KEY") && !(have.get("VAPID_PUBLIC_KEY") && have.get("VAPID_PRIVATE_KEY"))) {
    const k = webpush.generateVAPIDKeys();
    await store("VAPID_PUBLIC_KEY", k.publicKey);
    await store("VAPID_PRIVATE_KEY", k.privateKey);
    have.set("VAPID_PUBLIC_KEY", k.publicKey);
    have.set("VAPID_PRIVATE_KEY", k.privateKey);
  }
  apply("VAPID_PUBLIC_KEY", have.get("VAPID_PUBLIC_KEY") ?? null);
  apply("VAPID_PRIVATE_KEY", have.get("VAPID_PRIVATE_KEY") ?? null);

  // Einrichtungs-Code für den ersten Administrator (steht im Server-Log, solange es noch niemanden gibt)
  if ((await db.user.count()) === 0) {
    await ensure("SETUP_CODE", () => randomBytes(6).toString("hex").toUpperCase().replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3"));
    if (!envKeys.has("SETUP_CODE")) console.log(`[Jarvis] Ersteinrichtung offen – Einrichtungs-Code: ${process.env.SETUP_CODE}`);
  }
}

/** Einmal je Prozess laden (Start); erneute Aufrufe warten nur auf das erste Laden */
export function loadSettings() {
  return (g.__pmSettingsLoaded ??= load().catch((e) => {
    g.__pmSettingsLoaded = undefined;
    console.error("[Jarvis] Einstellungen konnten nicht geladen werden:", e);
  }));
}

/** Für die Oberfläche: ist ein Wert gesetzt, und woher kommt er? Geheime Werte werden nie zurückgegeben. */
export function settingState(key: EditableKey) {
  const set = Boolean(process.env[key]);
  return { set, source: envKeys.has(key) ? ("env" as const) : set ? ("app" as const) : null, value: SECRET.has(key) ? null : (process.env[key] ?? null) };
}

/** Speichern aus der Oberfläche. Leerer Wert bei Geheimnissen = unverändert lassen; `null` = löschen. */
export async function saveSettings(values: Partial<Record<EditableKey, string | null>>) {
  for (const [key, raw] of Object.entries(values) as [EditableKey, string | null | undefined][]) {
    if (raw === undefined || envKeys.has(key)) continue;
    const value = raw === null ? null : raw.trim();
    if (value === "" && SECRET.has(key)) continue;
    if (!value) {
      await db.appSetting.deleteMany({ where: { key } });
      apply(key, null);
    } else {
      await store(key, value);
      apply(key, value);
    }
  }
}

export async function clearSetupCode() {
  await db.appSetting.deleteMany({ where: { key: "SETUP_CODE" } });
  apply("SETUP_CODE", null);
}

export const AUTO_KEYS = AUTO;
