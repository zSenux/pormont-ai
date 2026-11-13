import "server-only";
import { cache } from "react";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { berlinDateTime, todayYmd } from "@/lib/berlin";

// Freischaltung durch Klaic Media: Jarvis ist für den Kunden erst nutzbar, wenn Klaic Media die Instanz freischaltet,
// und lässt sich jederzeit wieder sperren (z. B. bei Nichtzahlung) oder auf ein Datum befristen.
// Den Schlüssel KLAIC_KEY kennt nur Klaic Media – er steht ausschließlich als Umgebungsvariable im Hosting (Klaic Deploy),
// nie in der Datenbank oder in den Einstellungen der Oberfläche. Der Status liegt in AppSetting (KLAIC_FREISCHALTUNG).

const KEY = "KLAIC_FREISCHALTUNG";

const stored = z.object({
  aktiv: z.boolean(),
  bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hinweis: z.string().max(500).nullable().optional(),
  geaendert: z.string().optional(),
});
export type Freischaltung = z.infer<typeof stored>;

export type LicenseState = {
  ok: boolean;
  /** offen = noch nie freigeschaltet, gesperrt = von Klaic Media gesperrt, abgelaufen = Befristung vorbei, frei = nutzbar */
  status: "frei" | "offen" | "gesperrt" | "abgelaufen" | "entwicklung";
  bis: string | null;
  hinweis: string | null;
  geaendert: string | null;
};

/** Ist ein Klaic-Schlüssel hinterlegt? Ohne Schlüssel ist Jarvis in Produktion gesperrt, lokal (Entwicklung) frei. */
export const klaicKeySet = () => (process.env.KLAIC_KEY ?? "").length >= 16;

/** Klaic-Schlüssel prüfen (zeitkonstant) */
export function klaicKeyOk(input: string | null | undefined) {
  if (!klaicKeySet() || !input) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(input.trim()), h(process.env.KLAIC_KEY!));
}

async function readStored(): Promise<Freischaltung | null> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  try {
    const p = stored.safeParse(JSON.parse(row.value));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** Aktueller Status (ohne Zwischenspeicher – für Jobs und Telefon) */
export async function readLicense(): Promise<LicenseState> {
  const s = await readStored();
  const base = { bis: s?.bis ?? null, hinweis: s?.hinweis ?? null, geaendert: s?.geaendert ?? null };
  if (!klaicKeySet() && process.env.NODE_ENV !== "production") return { ok: true, status: "entwicklung", ...base };
  if (!s) return { ok: false, status: "offen", ...base };
  if (!s.aktiv) return { ok: false, status: "gesperrt", ...base };
  // Befristung: gilt bis einschließlich des Tages (Berliner Zeit)
  if (s.bis && s.bis < todayYmd()) return { ok: false, status: "abgelaufen", ...base };
  return { ok: true, status: "frei", ...base };
}

/** Status je Anfrage einmal lesen (Seiten, Aktionen, API) */
export const license = cache(readLicense);

export const licenseInput = z.object({
  aktiv: z.boolean(),
  bis: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum bitte als JJJJ-MM-TT.")
    .refine((s) => !Number.isNaN(berlinDateTime(s).getTime()), "Ungültiges Datum.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  hinweis: z.string().trim().max(500).nullable().optional(),
});

/** Nur für Klaic Media (Schlüssel vorher prüfen!): freischalten, sperren oder befristen */
export async function setLicense(input: z.infer<typeof licenseInput>) {
  const value: Freischaltung = { aktiv: input.aktiv, bis: input.bis || null, hinweis: input.hinweis || null, geaendert: new Date().toISOString() };
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
  console.log(`[Jarvis] Freischaltung geändert: ${value.aktiv ? "freigeschaltet" : "gesperrt"}${value.bis ? ` bis ${value.bis}` : ""}`);
  return readLicense();
}

/** Text für die Sperrseite und das Telefon */
export function lockReason(s: LicenseState) {
  if (s.status === "gesperrt") return "Jarvis ist derzeit von Klaic Media gesperrt.";
  if (s.status === "abgelaufen") return "Die Freischaltung von Jarvis ist abgelaufen.";
  return "Jarvis wartet noch auf die Freischaltung durch Klaic Media.";
}
