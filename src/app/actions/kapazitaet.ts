"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { saveCapConfig } from "@/lib/kapazitaet";

// Einstellungen der Kapazitätsplanung (Bereich Fertigung, nur Administratoren)

export async function saveCapacitySettings(_prev: { ok?: string; error?: string } | undefined, form: FormData) {
  const u = await requireArea("fertigung");
  if (u.role !== "ADMIN") return { error: "Nur Administratoren." };
  const p = z
    .object({ userIds: z.array(z.cuid()).max(100), hoursPerDay: z.coerce.number().min(1).max(12), productivePct: z.coerce.number().int().min(30).max(100) })
    .safeParse({ userIds: form.getAll("userIds"), hoursPerDay: String(form.get("hoursPerDay") ?? "8").replace(",", "."), productivePct: form.get("productivePct") ?? 85 });
  if (!p.success) return { error: "Stunden 1–12, produktiv 30–100 %." };
  await saveCapConfig(p.data);
  revalidatePath("/fertigung/kapazitaet");
  return { ok: "Gespeichert." };
}
