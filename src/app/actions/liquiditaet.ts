"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { berlinDateTime, todayYmd } from "@/lib/berlin";
import { INTERVAL_KEYS, saveLiqConfig } from "@/lib/buchhaltung/liquiditaet";

// Server-Actions Liquiditätsplanung (Bereich Buchhaltung)

type Result = { ok?: string; error?: string } | undefined;
const opt = (s: FormDataEntryValue | null) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
const euroCents = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const done = () => revalidatePath("/buchhaltung/liquiditaet");

export async function saveBalance(_prev: Result, form: FormData): Promise<Result> {
  await requireArea("buchhaltung");
  const bal = euroCents(opt(form.get("balance")));
  const reserve = euroCents(opt(form.get("reserve")));
  if (bal === null || Number.isNaN(bal)) return { error: "Kontostand bitte als Betrag, z. B. 48.250,00 (minus für Dispo)." };
  if (reserve !== null && (Number.isNaN(reserve) || reserve < 0)) return { error: "Reserve bitte als positiven Betrag." };
  const asOf = ymd.safeParse(opt(form.get("asOf")) ?? todayYmd());
  if (!asOf.success || asOf.data > todayYmd()) return { error: "Stichtag prüfen (heute oder früher)." };
  const weeks = z.coerce.number().int().min(4).max(26).catch(12).parse(form.get("weeks"));
  await saveLiqConfig({ balanceCents: bal, asOf: asOf.data, ...(reserve !== null ? { reserveCents: reserve } : {}), weeks });
  done();
  return { ok: "Gespeichert." };
}

export async function addCashItem(_prev: Result, form: FormData): Promise<Result> {
  const u = await requireArea("buchhaltung");
  const amount = euroCents(opt(form.get("amount")));
  const p = z
    .object({ name: z.string().trim().min(2).max(120), dir: z.enum(["in", "out"]), interval: z.enum(INTERVAL_KEYS), start: ymd, end: ymd.optional(), note: z.string().trim().max(500).optional() })
    .safeParse({ name: form.get("name"), dir: form.get("dir"), interval: form.get("interval"), start: form.get("start"), end: opt(form.get("end")), note: opt(form.get("note")) });
  if (!p.success || amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Bitte Bezeichnung, Betrag (> 0) und erste Fälligkeit angeben." };
  await db.cashItem.create({ data: { name: p.data.name, amountCents: p.data.dir === "in" ? amount : -amount, interval: p.data.interval, startDate: berlinDateTime(p.data.start), endDate: p.data.end ? berlinDateTime(p.data.end) : null, note: p.data.note ?? null, createdBy: u.name } });
  done();
  return { ok: "Geplante Zahlung angelegt." };
}

export async function deleteCashItem(id: string) {
  await requireArea("buchhaltung");
  await db.cashItem.delete({ where: { id: z.cuid().parse(id) } });
  done();
}
