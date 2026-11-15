"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { requireAdmin } from "@/lib/auth/user";
import { addManualTender, refreshTenders, saveTenderConfig, TENDER_STATUSES } from "@/lib/ausschreibungen";
import { ensurePhases, setPhase } from "@/lib/phases";

// Server-Actions Ausschreibungen (Bereich Akquise; Einstellungen nur Admin)

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const list = (s: FormDataEntryValue | null) => String(s ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const refresh = (id?: string) => {
  revalidatePath("/ausschreibungen");
  if (id) revalidatePath(`/ausschreibungen/${id}`);
};

export async function fetchTendersNow(): Promise<Result> {
  await requireArea("akquise");
  const r = await refreshTenders();
  refresh();
  return r.errors.length && !r.found ? { error: r.errors.join(" · ") } : { ok: `${r.found} Bekanntmachungen geprüft, ${r.fresh.length} neu passend.${r.errors.length ? ` Hinweis: ${r.errors.join(" · ")}` : ""}` };
}

export async function setTenderStatus(id: string, status: string, form?: FormData) {
  const u = await requireArea("akquise");
  const note = form ? z.string().trim().max(2000).optional().parse(opt(form.get("note"))) : undefined;
  await db.tender.update({ where: { id: z.cuid().parse(id) }, data: { status: z.enum(TENDER_STATUSES).parse(status), decidedBy: u.name, ...(note !== undefined ? { note } : {}) } });
  refresh(id);
}

export async function saveTenderNote(id: string, form: FormData) {
  await requireArea("akquise");
  await db.tender.update({ where: { id: z.cuid().parse(id) }, data: { note: z.string().trim().max(4000).parse(String(form.get("note") ?? "")) || null } });
  refresh(id);
}

/** Ausschreibung als Kundenanfrage/Projekt übernehmen (Phase Anfrage) */
export async function tenderToProject(id: string) {
  const u = await requireArea("akquise");
  const t = await db.tender.findUniqueOrThrow({ where: { id: z.cuid().parse(id) } });
  if (t.projectId) redirect(`/projekte/${t.projectId}`);
  const p = await db.project.create({
    data: {
      name: `Ausschreibung: ${t.title}`.slice(0, 200),
      customer: t.buyer,
      address: [t.postalCode, t.place].filter(Boolean).join(" ") || null,
      description: [t.description, t.url && `Bekanntmachung: ${t.url}`, t.deadline && `Angebotsfrist: ${t.deadline.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`].filter(Boolean).join("\n\n") || null,
      status: "PLANUNG",
      leaderId: u.id,
      createdById: u.id,
    },
  });
  await ensurePhases(p.id);
  if (t.deadline) await db.projectMilestone.create({ data: { projectId: p.id, title: "Angebotsfrist Ausschreibung", dueDate: t.deadline } });
  await setPhase({ projectId: p.id, key: "ANFRAGE", status: "LAEUFT", note: "Aus öffentlicher Ausschreibung übernommen", userName: u.name });
  await db.tender.update({ where: { id: t.id }, data: { projectId: p.id, status: "ANGEBOT", decidedBy: u.name } });
  refresh(id);
  redirect(`/projekte/${p.id}`);
}

export async function newManualTender(_prev: Result, form: FormData): Promise<Result> {
  const u = await requireArea("akquise");
  const p = z
    .object({ title: z.string().trim().min(5).max(500), buyer: z.string().trim().max(300).optional(), place: z.string().trim().max(300).optional(), postalCode: z.string().regex(/^\d{5}$/).optional(), url: z.url().max(1000).optional(), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), description: z.string().trim().max(4000).optional() })
    .safeParse({ title: form.get("title"), buyer: opt(form.get("buyer")), place: opt(form.get("place")), postalCode: opt(form.get("postalCode")), url: opt(form.get("url")), deadline: opt(form.get("deadline")), description: opt(form.get("description")) });
  if (!p.success) return { error: "Bitte Titel (mind. 5 Zeichen) und ggf. PLZ/Link prüfen." };
  await addManualTender(p.data, u);
  refresh();
  return { ok: "Ausschreibung erfasst." };
}

export async function saveTenderSettings(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  try {
    await saveTenderConfig({ ted: form.get("ted") === "on", cpv: list(form.get("cpv")).map((c) => c.replace(/-\d$/, "")), keywords: list(form.get("keywords")), plz: list(form.get("plz")), rss: list(form.get("rss")), minScore: Number(form.get("minScore") ?? 40), days: Number(form.get("days") ?? 10) });
  } catch (e) {
    if (e instanceof z.ZodError) return { error: `Bitte prüfen: ${e.issues.map((i) => i.path.join(".")).join(", ")} (CPV 8 Ziffern, PLZ-Anfänge, Feeds als https-Link).` };
    throw e;
  }
  refresh();
  return { ok: "Gespeichert – gilt ab dem nächsten Abruf." };
}
