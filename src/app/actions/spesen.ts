"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth/user";
import { berlinDateTime, todayYmd } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { KINDS, KIND_LABEL, euro, kmAmount, mealAmountAt, MEAL_RATES, parseEuro } from "@/lib/spesen";
import { saveSpesenRates, spesenRates } from "@/lib/spesen-config";
import { monthRange } from "@/lib/zeiten";

// Spesen: Mitarbeiter reichen ein, ein Administrator genehmigt bzw. lehnt ab und markiert als ausgezahlt.

const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
type Result = { ok?: string; error?: string } | undefined;

export async function addExpense(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = z
    .object({
      kind: z.enum(KINDS),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().trim().max(300).optional(),
      projectId: z.cuid().optional(),
      km: z.coerce.number().int().min(1).max(5000).optional(),
      mealDay: z.enum(Object.keys(MEAL_RATES) as [keyof typeof MEAL_RATES]).optional(),
      amount: z.string().max(20).optional(),
      fileId: z.cuid().optional(),
    })
    .safeParse(Object.fromEntries(["kind", "day", "description", "projectId", "km", "mealDay", "amount", "fileId"].map((k) => [k, opt(form.get(k))])));
  if (!p.success) return { error: "Bitte die Angaben prüfen." };
  const e = p.data;
  if (e.day > todayYmd()) return { error: "Spesen für zukünftige Tage gehen nicht." };
  const meals = { breakfast: form.get("breakfast") === "on", lunch: form.get("lunch") === "on", dinner: form.get("dinner") === "on" };
  let amountCents: number | null = null;
  let description = e.description ?? "";
  const rates = await spesenRates();
  const nightFlat = e.kind === "UEBERNACHTUNG" && form.get("pauschal") === "on";
  if (e.kind === "VERPFLEGUNG") {
    if (!e.mealDay) return { error: "Bitte angeben, wie lange du unterwegs warst." };
    const dup = await db.expense.findFirst({ where: { userId: user.id, kind: "VERPFLEGUNG", day: berlinDateTime(e.day), status: { not: "ABGELEHNT" } } });
    if (dup) return { error: "Für diesen Tag ist schon eine Verpflegungspauschale eingetragen." };
    amountCents = mealAmountAt(rates, e.mealDay, meals);
    if (!amountCents) return { error: "Alle Mahlzeiten gestellt – es bleibt keine Pauschale." };
  } else if (e.kind === "FAHRT") {
    if (!e.km) return { error: "Bitte die gefahrenen Kilometer angeben." };
    amountCents = kmAmount(e.km, rates.km);
  } else if (nightFlat) {
    amountCents = rates.night;
    if (!amountCents) return { error: "Für Übernachtungen ohne Beleg ist keine Pauschale hinterlegt." };
  } else {
    amountCents = parseEuro(e.amount ?? "");
    if (!amountCents) return { error: "Bitte den Betrag angeben, z. B. 23,80." };
  }
  if (!description) description = e.kind === "FAHRT" ? "Dienstfahrt" : nightFlat ? "Übernachtung (Pauschale ohne Beleg)" : KIND_LABEL[e.kind];
  if (e.fileId) {
    const f = await db.storedFile.findUnique({ where: { id: e.fileId }, select: { kind: true } });
    if (f?.kind !== "spesen") return { error: "Beleg nicht gefunden – bitte neu fotografieren." };
  }
  await db.expense.create({
    data: {
      userId: user.id, day: berlinDateTime(e.day), kind: e.kind, description, projectId: e.projectId ?? null,
      km: e.kind === "FAHRT" ? e.km : null, mealDay: e.kind === "VERPFLEGUNG" ? e.mealDay : null,
      ...(e.kind === "VERPFLEGUNG" ? meals : {}), amountCents, fileId: nightFlat ? null : (e.fileId ?? null),
    },
  });
  after(() => notifyAdmins(`Neue Spesen von ${user.name}`, `${KIND_LABEL[e.kind]}: ${description} · ${euro(amountCents!)}`, user.id));
  revalidatePath("/spesen");
  return { ok: `Eingereicht: ${euro(amountCents)}. Ein Administrator prüft das.` };
}

async function notifyAdmins(title: string, body: string, except: string) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", id: { not: except } }, select: { id: true } });
  for (const a of admins) await sendPush({ title, body, url: "/spesen?ansicht=pruefen", tag: "spesen", userId: a.id });
}

export async function deleteExpense(id: string) {
  const user = await requireUser();
  const e = await db.expense.findUnique({ where: { id: z.cuid().parse(id) } });
  if (!e || e.userId !== user.id || e.status !== "EINGEREICHT") return;
  await db.expense.delete({ where: { id: e.id } });
  if (e.fileId) await db.storedFile.deleteMany({ where: { id: e.fileId, kind: "spesen" } });
  revalidatePath("/spesen");
}

export async function reviewExpense(id: string, decision: "GENEHMIGT" | "ABGELEHNT", note?: string) {
  const admin = await requireAdmin();
  const d = z.enum(["GENEHMIGT", "ABGELEHNT"]).parse(decision);
  const n = z.string().trim().max(300).optional().parse(note || undefined);
  const e = await db.expense.updateMany({ where: { id: z.cuid().parse(id), status: { in: ["EINGEREICHT", "GENEHMIGT", "ABGELEHNT"] } }, data: { status: d, reviewedBy: admin.name, reviewedAt: new Date(), reviewNote: n ?? null } });
  if (e.count) {
    const row = await db.expense.findUniqueOrThrow({ where: { id } });
    after(() => sendPush({ title: d === "GENEHMIGT" ? "Spesen genehmigt" : "Spesen abgelehnt", body: `${row.description} · ${euro(row.amountCents)}${n ? ` – ${n}` : ""}`, url: "/spesen", tag: "spesen", userId: row.userId }));
  }
  revalidatePath("/spesen");
}

/** Alle offenen Spesen eines Mitarbeiters im Monat genehmigen */
export async function approveMonth(userId: string, month: string) {
  const admin = await requireAdmin();
  const r = monthRange(z.string().regex(/^\d{4}-\d{2}$/).parse(month));
  await db.expense.updateMany({ where: { userId: z.cuid().parse(userId), status: "EINGEREICHT", day: { gte: r.from, lt: r.to } }, data: { status: "GENEHMIGT", reviewedBy: admin.name, reviewedAt: new Date() } });
  revalidatePath("/spesen");
}

/** Genehmigte Spesen eines Mitarbeiters im Monat als ausgezahlt markieren (z. B. mit der Lohnabrechnung) */
export async function markPaid(userId: string, month: string) {
  await requireAdmin();
  const r = monthRange(z.string().regex(/^\d{4}-\d{2}$/).parse(month));
  await db.expense.updateMany({ where: { userId: z.cuid().parse(userId), status: "GENEHMIGT", day: { gte: r.from, lt: r.to } }, data: { status: "AUSGEZAHLT", paidAt: new Date() } });
  revalidatePath("/spesen");
}

/** Spesensätze der Firma speichern (nur Admin) */
export async function saveRatesAction(_prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  // Betrag in Euro → Cent; „0“ ist erlaubt (Satz wird nicht gezahlt)
  const c = (k: string) => {
    const raw = String(form.get(k) ?? "").trim();
    if (/^0+([.,]0*)?$/.test(raw)) return 0;
    return parseEuro(raw) ?? NaN;
  };
  const vals = { TAG8: c("TAG8"), REISE: c("REISE"), TAG24: c("TAG24"), km: c("km"), night: c("night") };
  if (Object.values(vals).some((v) => !Number.isFinite(v))) return { error: "Bitte alle Sätze als Betrag eintragen, z. B. 20,00." };
  try {
    await saveSpesenRates({ meal: { TAG8: vals.TAG8, REISE: vals.REISE, TAG24: vals.TAG24 }, km: vals.km, night: vals.night });
  } catch {
    return { error: "Sätze außerhalb des erlaubten Bereichs (km höchstens 2,00 €)." };
  }
  revalidatePath("/spesen");
  return { ok: "Spesensätze gespeichert." };
}
