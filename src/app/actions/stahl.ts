"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { formatDate, todayYmd } from "@/lib/berlin";
import { FAMILY_STOCK_CATEGORY, findProfile, MATERIAL_LABEL, MATERIALS, STEEL_FAMILIES, STEEL_ONLY, unitWeight } from "@/lib/steel";
import { pricePerKg, saveSteelPrices, steelPrices } from "@/lib/steel-prices";

// Server-Actions für den Stahl-Materialkatalog: eigene €/kg-Preise speichern, Profil ins Materiallager übernehmen

type Result = { ok?: string; error?: string } | undefined;

const eur = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim().replace(/\s|€/g, "").replace(",", ".") : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : NaN;
};

export async function saveSteelPriceForm(_prev: Result, form: FormData): Promise<Result> {
  await requireArea("einkauf");
  const vals = { STAHL: eur(form.get("STAHL")), EDELSTAHL: eur(form.get("EDELSTAHL")), ALU: eur(form.get("ALU")), verzinken: eur(form.get("verzinken")) };
  const familien: Record<string, number> = {};
  for (const f of STEEL_FAMILIES) {
    const v = eur(form.get(`fam_${f}`));
    if (v !== null) familien[f] = v;
  }
  if ([...Object.values(vals), ...Object.values(familien)].some((v) => Number.isNaN(v))) return { error: "Preise bitte als Zahl in € je kg eingeben, z. B. 1,35." };
  const quelle = typeof form.get("quelle") === "string" ? String(form.get("quelle")).trim().slice(0, 200) || null : null;
  await saveSteelPrices({ ...vals, familien, quelle, stand: todayYmd() });
  revalidatePath("/lieferanten/stahl");
  return { ok: "Preise gespeichert." };
}

/** Profil als Lagerartikel anlegen (Einheit m bzw. m², EK = kg × €/kg). Gibt es den Namen schon, dorthin springen. */
export async function addSteelToStock(name: string, material: string) {
  await requireArea("lager");
  const p = findProfile(z.string().max(80).parse(name));
  if (!p) throw new Error("Profil nicht gefunden.");
  const mat = z.enum(MATERIALS).catch("STAHL").parse(material);
  const m = STEEL_ONLY.has(p.family) ? "STAHL" : mat;
  const itemName = m === "STAHL" ? p.name : `${p.name} ${m === "EDELSTAHL" ? "Edelstahl" : "Alu"}`;
  const existing = await db.stockItem.findFirst({ where: { name: { equals: itemName, mode: "insensitive" } }, select: { id: true } });
  if (existing) redirect(`/lager/${existing.id}`);
  const kgPer = pricePerKg(await steelPrices(), p.family, m);
  const weight = unitWeight(p, m);
  const item = await db.stockItem.create({
    data: {
      name: itemName,
      category: FAMILY_STOCK_CATEGORY[p.family],
      material: m === "STAHL" ? null : MATERIAL_LABEL[m],
      unit: p.per,
      price: kgPer !== null ? Math.round(weight * kgPer * 100) / 100 : null,
      notes: `Aus dem Stahl-Katalog: ${weight.toLocaleString("de-DE")} kg/${p.per}${kgPer !== null ? `, EK aus ${kgPer.toLocaleString("de-DE")} €/kg (Stand ${formatDate(new Date())})` : ""}.`,
    },
  });
  revalidatePath("/lager");
  redirect(`/lager/${item.id}`);
}
