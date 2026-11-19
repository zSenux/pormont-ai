"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { crewSchema, DiaryError, refreshWeather, saveDiary, saveHead } from "@/lib/bautagebuch";
import { CREW_ROLES, EQUIPMENT, headSchema, reportSchema, type Report } from "@/lib/bautagebuch-shared";

// Server-Actions Bautagebuch (Bereich Projekte)

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" ? s.trim() : undefined);
const numOf = (s: FormDataEntryValue | null | undefined) => {
  const t = typeof s === "string" ? s.trim().replace(",", ".") : "";
  return t === "" ? null : Number(t);
};
const textOf = (s: FormDataEntryValue | null) => opt(s) || null;

/** Bautagesbericht-Felder aus dem Formular (Kopf, Schichten, Witterung, Geräte, Änderungen, Anordnungen) */
function reportFrom(form: FormData) {
  const manual = form.get("wxManual") === "1";
  const col = (k: string) => form.getAll(k);
  const changes = col("chText").map((t, k) => ({ men: numOf(col("chMen")[k]), hours: numOf(col("chHours")[k]), crane: numOf(col("chCrane")[k]), platforms: numOf(col("chPlatforms")[k]), text: textOf(t) })).filter((c) => c.text || c.men || c.hours || c.crane || c.platforms);
  const report: Report = {
    no: numOf(form.get("rNo")),
    foreman: textOf(form.get("rForeman")),
    trade: textOf(form.get("rTrade")),
    earlyFrom: textOf(form.get("rEarlyFrom")),
    earlyTo: textOf(form.get("rEarlyTo")),
    lateFrom: textOf(form.get("rLateFrom")),
    lateTo: textOf(form.get("rLateTo")),
    temp: numOf(form.get("rTemp")),
    sun: manual ? form.get("rSun") === "1" : null,
    rain: manual ? form.get("rRain") === "1" : null,
    snow: manual ? form.get("rSnow") === "1" : null,
    equipment: Object.fromEntries(EQUIPMENT.map(([k]) => [k, opt(form.get(`eq_${k}`)) ?? ""]).filter(([, v]) => v)),
    changes,
    orders: textOf(form.get("rOrders")),
  };
  return reportSchema.safeParse(report);
}

export async function saveDiaryEntry(_prev: Result, form: FormData): Promise<Result> {
  const u = await requireArea("projekte");
  // Personal: Zeilen name[] / hours[]
  const names = form.getAll("crewName").map(String);
  const hours = form.getAll("crewHours").map(String);
  const ids = form.getAll("crewUserId").map(String);
  const roles = form.getAll("crewRole").map(String);
  const crew = crewSchema.safeParse(
    names
      .map((n, k) => ({ name: n.trim(), userId: ids[k] || null, hours: hours[k]?.trim() ? Number(hours[k].replace(",", ".")) : null, role: (CREW_ROLES as readonly string[]).includes(roles[k]) ? (roles[k] as (typeof CREW_ROLES)[number]) : null }))
      .filter((c) => c.name),
  );
  if (!crew.success) return { error: "Personal prüfen: Name und Stunden (0–24)." };
  const report = reportFrom(form);
  if (!report.success) return { error: `Bericht prüfen: ${report.error.issues[0]?.path.join(".")} – ${report.error.issues[0]?.message}` };
  try {
    const e = await saveDiary(
      { projectId: String(form.get("projectId") ?? ""), day: String(form.get("day") ?? ""), weather: opt(form.get("weather")) || undefined, crew: crew.data, work: opt(form.get("work")) ?? null, material: opt(form.get("material")) ?? null, obstacles: opt(form.get("obstacles")) ?? null, visitors: opt(form.get("visitors")) ?? null, report: report.data },
      u,
    );
    revalidatePath(`/projekte/${e.projectId}/bautagebuch`);
    revalidatePath("/bautagebuch");
    return { ok: "Gespeichert." };
  } catch (e) {
    if (e instanceof DiaryError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Bitte Tag und Projekt prüfen." };
    // Unerwarteter Fehler: Meldung im Formular statt „This page couldn't load“ – Eingaben bleiben stehen
    console.error("[Bautagebuch] Speichern fehlgeschlagen", e);
    return { error: "Speichern hat nicht geklappt – bitte noch einmal versuchen. Bleibt der Fehler, Klaic Media Bescheid geben." };
  }
}

/** Kopf der Bautagesberichte je Projekt (Auftraggeber, Projekt-Nr., Gewerk, Ort, erste Nr.) */
export async function saveDiaryHead(_prev: Result, form: FormData): Promise<Result> {
  await requireArea("projekte");
  const projectId = z.cuid().safeParse(form.get("projectId"));
  const head = headSchema.safeParse({ client: textOf(form.get("client")), clientNo: textOf(form.get("clientNo")), trade: textOf(form.get("trade")), place: textOf(form.get("place")), startNo: numOf(form.get("startNo")) });
  if (!projectId.success || !head.success) return { error: "Bitte Eingaben prüfen (erste Nr. als ganze Zahl)." };
  await saveHead(projectId.data, head.data);
  revalidatePath(`/projekte/${projectId.data}/bautagebuch`);
  return { ok: "Kopf gespeichert." };
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
