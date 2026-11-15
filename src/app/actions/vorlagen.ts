"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user";
import { requireArea } from "@/lib/rights";
import { todayYmd } from "@/lib/berlin";
import { BookError } from "@/lib/buchhaltung/docs";
import { HOURS_LABEL, KALK_LABEL, kalkSchema, PRODUCTS, type Kalk } from "@/lib/vorlagen/model";
import { createQuoteFromConfig, kalkValues, readJpeg, saveKalkValues, setConfigImage, VorlagenError } from "@/lib/vorlagen/kalk";

// Server-Actions für Angebotsvorlagen: Angebot aus Konfiguration anlegen, Kalkulationswerte speichern, Ansicht nachreichen.

type Result = { ok?: string; error?: string } | undefined;

const createInput = z.object({
  product: z.enum(PRODUCTS),
  params: z.record(z.string(), z.unknown()),
  customerId: z.string().max(40).nullish(),
  projectId: z.string().max(40).nullish(),
  image: z.string().max(2_100_000).nullish(),
});

export async function createQuoteAction(input: z.infer<typeof createInput>): Promise<{ error: string } | undefined> {
  const user = await requireArea("buchhaltung");
  let id: string;
  try {
    const i = createInput.parse(input);
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const baseUrl = host ? `${h.get("x-forwarded-proto")?.split(",")[0] || "https"}://${host}` : null;
    const r = await createQuoteFromConfig({ product: i.product, params: i.params, customerId: i.customerId, projectId: i.projectId, image: readJpeg(i.image), baseUrl, user });
    id = r.doc.id;
  } catch (e) {
    if (e instanceof z.ZodError) return { error: `Eingaben prüfen: ${e.issues.map((x) => x.message).join("; ")}` };
    if (e instanceof VorlagenError || e instanceof BookError) return { error: e.message };
    throw e;
  }
  revalidatePath("/buchhaltung/vorlagen");
  redirect(`/buchhaltung/beleg/${id}`);
}

export async function saveConfigImageAction(id: string, image: string): Promise<{ error?: string }> {
  await requireArea("buchhaltung");
  try {
    const buf = readJpeg(z.string().max(2_100_000).parse(image));
    if (!buf) return { error: "Keine Ansicht." };
    await setConfigImage(z.string().max(40).parse(id), buf);
    return {};
  } catch (e) {
    if (e instanceof VorlagenError) return { error: e.message };
    throw e;
  }
}

const val = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim().replace(/\s|€|%/g, "").replace(",", ".") : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

export async function saveKalkForm(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const cur = await kalkValues();
  const next: Record<string, unknown> = { ...cur, zeiten: { ...cur.zeiten }, stand: todayYmd() };
  for (const k of Object.keys(KALK_LABEL)) next[k] = val(form.get(k));
  const zeiten = next.zeiten as Record<string, Record<string, number | null>>;
  for (const p of PRODUCTS) {
    zeiten[p] = {};
    for (const h of Object.keys(HOURS_LABEL)) zeiten[p][h] = val(form.get(`${p}_${h}`));
  }
  const all = [...Object.keys(KALK_LABEL).map((k) => next[k]), ...PRODUCTS.flatMap((p) => Object.values(zeiten[p]))];
  if (all.some((v) => Number.isNaN(v))) return { error: "Bitte nur Zahlen eintragen, z. B. 62 oder 2,5." };
  const parsed = kalkSchema.safeParse(next);
  if (!parsed.success) return { error: `Ungültige Werte: ${parsed.error.issues.map((x) => x.path.join(".")).join(", ")}` };
  await saveKalkValues(parsed.data as Kalk);
  revalidatePath("/buchhaltung/vorlagen");
  return { ok: "Kalkulationswerte gespeichert." };
}
