"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { klaicKeyOk, klaicKeySet, licenseInput, readLicense, setLicense, type LicenseState } from "@/lib/license";

// Klaic-Bereich (/klaic): ohne Jarvis-Anmeldung, geschützt nur durch KLAIC_KEY aus dem Hosting. Fehlversuche je IP gedrosselt.

const fails = new Map<string, { n: number; until: number }>();

export type KlaicResult = { error?: string; ok?: string; state?: LicenseState };

const input = z.object({
  key: z.string().min(1).max(200),
  aktion: z.enum(["status", "freischalten", "sperren"]),
  bis: z.string().max(10).optional(),
  hinweis: z.string().max(500).optional(),
});

export async function klaicLicense(_prev: KlaicResult | undefined, form: FormData): Promise<KlaicResult> {
  if (!klaicKeySet()) return { error: "KLAIC_KEY ist im Hosting nicht gesetzt (mindestens 16 Zeichen)." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "lokal";
  const f = fails.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) return { error: "Zu viele Fehlversuche. Bitte in 30 Minuten erneut versuchen." };
  const p = input.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Ungültige Eingabe." };
  if (!klaicKeyOk(p.data.key)) {
    fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 30 * 60_000 });
    return { error: "Schlüssel stimmt nicht." };
  }
  fails.delete(ip);
  if (p.data.aktion === "status") return { state: await readLicense() };
  const data = licenseInput.safeParse({ aktiv: p.data.aktion === "freischalten", bis: p.data.bis ?? null, hinweis: p.data.hinweis ?? null });
  if (!data.success) return { error: data.error.issues[0]?.message ?? "Ungültige Eingabe." };
  const state = await setLicense(data.data);
  return { ok: p.data.aktion === "freischalten" ? "Jarvis ist freigeschaltet." : "Jarvis ist gesperrt.", state };
}
