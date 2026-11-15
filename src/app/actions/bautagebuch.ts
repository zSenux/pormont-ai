"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { crewSchema, DiaryError, refreshWeather, saveDiary } from "@/lib/bautagebuch";

// Server-Actions Bautagebuch (Bereich Projekte)

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" ? s.trim() : undefined);

export async function saveDiaryEntry(_prev: Result, form: FormData): Promise<Result> {
  const u = await requireArea("projekte");
  // Personal: Zeilen name[] / hours[]
  const names = form.getAll("crewName").map(String);
  const hours = form.getAll("crewHours").map(String);
  const ids = form.getAll("crewUserId").map(String);
  const crew = crewSchema.safeParse(
    names
      .map((n, k) => ({ name: n.trim(), userId: ids[k] || null, hours: hours[k]?.trim() ? Number(hours[k].replace(",", ".")) : null }))
      .filter((c) => c.name),
  );
  if (!crew.success) return { error: "Personal prüfen: Name und Stunden (0–24)." };
  try {
    const e = await saveDiary(
      { projectId: String(form.get("projectId") ?? ""), day: String(form.get("day") ?? ""), weather: opt(form.get("weather")) || undefined, crew: crew.data, work: opt(form.get("work")) ?? null, material: opt(form.get("material")) ?? null, obstacles: opt(form.get("obstacles")) ?? null, visitors: opt(form.get("visitors")) ?? null },
      u,
    );
    revalidatePath(`/projekte/${e.projectId}/bautagebuch`);
    revalidatePath("/bautagebuch");
    return { ok: "Gespeichert." };
  } catch (e) {
    if (e instanceof DiaryError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Bitte Tag und Projekt prüfen." };
    throw e;
  }
}

export async function diaryWeather(entryId: string) {
  await requireArea("projekte");
  try {
    const e = await refreshWeather(z.cuid().parse(entryId));
    revalidatePath(`/projekte/${e.projectId}/bautagebuch`);
    return {};
  } catch (e) {
    if (e instanceof DiaryError) return { error: e.message };
    throw e;
  }
}

export async function deleteDiaryEntry(entryId: string) {
  await requireArea("projekte");
  const e = await db.diaryEntry.delete({ where: { id: z.cuid().parse(entryId) } });
  revalidatePath(`/projekte/${e.projectId}/bautagebuch`);
}
