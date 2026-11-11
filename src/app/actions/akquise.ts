"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime } from "@/lib/berlin";
import { PlacesError, placeResultSchema, searchPlaces, type PlaceResult } from "@/lib/akquise/places";
import { AkquiseError, checkLeadWebsite, writeLetter, writePitch } from "@/lib/akquise/leads";
import { STAGES, STAGE_LABEL } from "@/lib/akquise/stages";

// Server-Actions der Neukunden-Akquise

const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
type Result = { ok?: string; error?: string } | undefined;

function errorText(e: unknown) {
  if (e instanceof PlacesError || e instanceof AkquiseError) return e.message;
  console.error("[akquise]", e);
  return "Das hat nicht geklappt – bitte noch einmal.";
}

// ---------- Google-Suche ----------
export async function searchLeads(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ query: z.string().trim().min(2, "Bitte eine Branche angeben.").max(80), location: z.string().trim().min(2, "Bitte einen Ort angeben.").max(80) }).safeParse({ query: form.get("query"), location: form.get("location") });
  if (!p.success) return { error: p.error.issues[0]?.message };
  let res;
  try {
    res = await searchPlaces({ query: p.data.query, location: p.data.location });
  } catch (e) {
    return { error: errorText(e) };
  }
  const s = await db.leadSearch.create({ data: { query: p.data.query, location: p.data.location, results: res.results, nextPageToken: res.nextPageToken, createdById: user.id } });
  redirect(`/akquise/suche?id=${s.id}`);
}

export async function moreResults(searchId: string): Promise<Result> {
  await requireUser();
  const s = await db.leadSearch.findUnique({ where: { id: z.cuid().parse(searchId) } });
  if (!s?.nextPageToken) return { error: "Keine weiteren Treffer." };
  try {
    const res = await searchPlaces({ query: s.query, location: s.location, pageToken: s.nextPageToken });
    const old = z.array(placeResultSchema).parse(s.results);
    await db.leadSearch.update({ where: { id: s.id }, data: { results: [...old, ...res.results], nextPageToken: res.nextPageToken } });
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/akquise/suche");
  return { ok: "Weitere Treffer geladen." };
}

/** Ausgewählte Treffer übernehmen – Daten kommen aus der gespeicherten Suche, nie vom Browser */
export async function importLeads(form: FormData) {
  const user = await requireUser();
  const searchId = z.cuid().parse(form.get("searchId"));
  const ids = new Set(form.getAll("placeId").map(String));
  const s = await db.leadSearch.findUniqueOrThrow({ where: { id: searchId } });
  const picked = z.array(placeResultSchema).parse(s.results).filter((r: PlaceResult) => ids.has(r.placeId));
  let n = 0;
  for (const r of picked) {
    const exists = await db.lead.findUnique({ where: { placeId: r.placeId }, select: { id: true } });
    if (exists) continue;
    await db.lead.create({
      data: {
        name: r.name, category: s.query, phone: r.phone, website: r.website, street: r.street, postalCode: r.postalCode, city: r.city,
        placeId: r.placeId, rating: r.rating, reviews: r.reviews, mapsUrl: r.mapsUrl, source: "GOOGLE", createdById: user.id,
        activities: { create: { kind: "NOTIZ", text: `Aus Google-Suche „${s.query} in ${s.location}“ übernommen.`, userName: user.name } },
      },
    });
    n++;
  }
  revalidatePath("/akquise");
  redirect(`/akquise?neu=${n}`);
}

// ---------- Leads ----------
const leadForm = z.object({
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().max(100).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  website: z.url({ protocol: /^https?$/ }).max(300).optional(),
  street: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(10).optional(),
  city: z.string().trim().max(100).optional(),
  source: z.enum(["MANUELL", "EMPFEHLUNG", "ANFRAGE", "GOOGLE"]).optional(),
  value: z.coerce.number().int().min(0).max(100_000_000).optional(),
  notes: z.string().trim().max(4000).optional(),
});
const readLead = (form: FormData) => {
  const raw = Object.fromEntries(["name", "category", "contactName", "email", "phone", "website", "street", "postalCode", "city", "source", "value", "notes"].map((k) => [k, opt(form.get(k))]));
  if (typeof raw.website === "string" && !/^https?:\/\//i.test(raw.website)) raw.website = `https://${raw.website}`;
  return leadForm.safeParse(raw);
};

export async function createLead(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = readLead(form);
  if (!p.success) return { error: `Eingabe prüfen: ${p.error.issues[0]?.path.join(".")}` };
  const lead = await db.lead.create({ data: { ...p.data, source: p.data.source ?? "MANUELL", createdById: user.id, activities: { create: { kind: "NOTIZ", text: "Von Hand angelegt.", userName: user.name } } } });
  redirect(`/akquise/${lead.id}`);
}

export async function updateLead(id: string, _prev: Result, form: FormData): Promise<Result> {
  await requireUser();
  const p = readLead(form);
  if (!p.success) return { error: `Eingabe prüfen: ${p.error.issues[0]?.path.join(".")}` };
  const d = p.data;
  await db.lead.update({
    where: { id: z.cuid().parse(id) },
    data: { name: d.name, category: d.category ?? null, contactName: d.contactName ?? null, email: d.email ?? null, phone: d.phone ?? null, website: d.website ?? null, street: d.street ?? null, postalCode: d.postalCode ?? null, city: d.city ?? null, value: d.value ?? null, notes: d.notes ?? null },
  });
  revalidatePath(`/akquise/${id}`);
  return { ok: "Gespeichert." };
}

export async function setLeadStage(id: string, stage: string) {
  const user = await requireUser();
  const s = z.enum(STAGES).parse(stage);
  const lead = await db.lead.findUniqueOrThrow({ where: { id: z.cuid().parse(id) } });
  if (lead.stage === s) return;
  await db.lead.update({ where: { id: lead.id }, data: { stage: s, ...(s === "GEWONNEN" || s === "VERLOREN" ? { nextFollowUpAt: null } : {}) } });
  await db.leadActivity.create({ data: { leadId: lead.id, kind: "STUFE", text: `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[s]}`, userName: user.name } });
  revalidatePath(`/akquise/${id}`);
  revalidatePath("/akquise");
}

export async function addLeadActivity(id: string, form: FormData) {
  const user = await requireUser();
  const p = z
    .object({ kind: z.enum(["NOTIZ", "ANRUF", "BRIEF", "MAIL", "TERMIN"]), text: z.string().trim().min(1).max(4000), followUp: ymd.optional() })
    .parse({ kind: form.get("kind"), text: form.get("text"), followUp: opt(form.get("followUp")) });
  const lead = await db.lead.findUniqueOrThrow({ where: { id: z.cuid().parse(id) } });
  await db.leadActivity.create({ data: { leadId: lead.id, kind: p.kind, text: p.text, userName: user.name } });
  const data: { nextFollowUpAt?: Date; stage?: "KONTAKTIERT" | "TERMIN" } = {};
  if (p.followUp) data.nextFollowUpAt = berlinDateTime(p.followUp, "09:00");
  // Erster Kontakt / Termin schiebt die Stufe automatisch weiter
  if (lead.stage === "NEU" && p.kind !== "NOTIZ") data.stage = "KONTAKTIERT";
  if ((lead.stage === "NEU" || lead.stage === "KONTAKTIERT") && p.kind === "TERMIN") data.stage = "TERMIN";
  if (data.stage) await db.leadActivity.create({ data: { leadId: lead.id, kind: "STUFE", text: `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[data.stage]}`, userName: user.name } });
  await db.lead.update({ where: { id: lead.id }, data });
  revalidatePath(`/akquise/${id}`);
  revalidatePath("/akquise");
}

export async function setFollowUp(id: string, day: string | null) {
  await requireUser();
  await db.lead.update({ where: { id: z.cuid().parse(id) }, data: { nextFollowUpAt: day ? berlinDateTime(ymd.parse(day), "09:00") : null } });
  revalidatePath(`/akquise/${id}`);
  revalidatePath("/akquise");
}

/** Einwilligung für E-Mails festhalten (Anfrage vom Kunden oder ausdrückliches Ja am Telefon) */
export async function setEmailConsent(id: string, on: boolean) {
  const user = await requireUser();
  const lead = await db.lead.update({ where: { id: z.cuid().parse(id) }, data: { emailConsentAt: on ? new Date() : null } });
  await db.leadActivity.create({ data: { leadId: lead.id, kind: "NOTIZ", text: on ? "Einwilligung für E-Mails erhalten." : "Einwilligung für E-Mails zurückgenommen.", userName: user.name } });
  revalidatePath(`/akquise/${id}`);
}

export async function deleteLead(id: string) {
  await requireUser();
  await db.lead.delete({ where: { id: z.cuid().parse(id) } });
  revalidatePath("/akquise");
  redirect("/akquise");
}

export async function runLeadTool(id: string, what: "check" | "pitch" | "letter"): Promise<Result> {
  await requireUser();
  const leadId = z.cuid().parse(id);
  try {
    if (what === "check") await checkLeadWebsite(leadId);
    else if (what === "pitch") await writePitch(leadId);
    else await writeLetter(leadId);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/akquise/${id}`);
  return { ok: what === "check" ? "Website geprüft." : what === "pitch" ? "Gesprächsleitfaden erstellt." : "Brief erstellt." };
}
