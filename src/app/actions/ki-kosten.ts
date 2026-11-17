"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/user";
import { kiConfigSchema, saveKiConfig } from "@/lib/ki-kosten";
import { kiModelSchema, saveKiModelConfig } from "@/lib/ki-modell";
import { KI_FEATURES } from "@/lib/ki-modell-shared";

type Result = { ok?: string; error?: string } | undefined;

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  return s ? Number(s) : null;
};

/** Kurs USD → EUR und Monatsbudget für die KI-Kosten speichern (nur Admin) */
export async function saveKiConfigAction(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  // Kurs mit Komma („0,86“) – hier keine Tausenderpunkte
  const rate = Number(String(form.get("usdEur") ?? "").trim().replace(",", "."));
  const p = kiConfigSchema.safeParse({ usdEur: rate, budgetEur: num(form.get("budgetEur")) || null });
  if (!p.success) return { error: "Bitte prüfen: Kurs zwischen 0,30 und 3,00, Budget als Betrag in Euro (leer = kein Budget)." };
  await saveKiConfig(p.data);
  revalidatePath("/ki-kosten");
  return { ok: "Gespeichert." };
}

/** KI-Modell: Standard (= günstigstes) und eigene Wahl je Funktion speichern (nur Admin) */
export async function saveKiModelAction(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const features: Record<string, string> = {};
  for (const f of KI_FEATURES) {
    const v = String(form.get(`f_${f.key}`) ?? "");
    if (v) features[f.key] = v;
  }
  const p = kiModelSchema.safeParse({ standard: form.get("standard"), features });
  if (!p.success) return { error: "Unbekanntes Modell – bitte neu laden." };
  await saveKiModelConfig(p.data);
  revalidatePath("/ki-kosten");
  return { ok: "Gespeichert – gilt ab dem nächsten Aufruf." };
}
