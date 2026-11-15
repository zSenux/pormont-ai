"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { BookError } from "@/lib/buchhaltung/docs";
import { pauseDunning, releaseDunning, setCustomerNoDunning } from "@/lib/buchhaltung/mahnwesen";

// Mahnwesen: Freigabe der Mahnvorschläge nur durch Administratoren (Chef). Nichts geht ohne diesen Klick raus.

type Result = { ok?: string; error?: string };
const id = z.string().min(5).max(40);
const refresh = () => {
  revalidatePath("/buchhaltung", "layout");
};

export async function releaseDunningAction(docId: string, mode: "mail" | "post"): Promise<Result> {
  const u = await requireArea("buchhaltung");
  if (u.role !== "ADMIN") return { error: "Mahnungen gibt nur die Geschäftsführung frei." };
  try {
    const r = await releaseDunning(id.parse(docId), mode === "post" ? "post" : "mail", u);
    refresh();
    return { ok: r.text };
  } catch (e) {
    if (e instanceof BookError) return { error: e.message };
    throw e;
  }
}

/** Alle jetzt fälligen Vorschläge auf einmal freigeben (Rückfrage im Browser) */
export async function releaseAllAction(docIds: string[]): Promise<Result> {
  const u = await requireArea("buchhaltung");
  if (u.role !== "ADMIN") return { error: "Mahnungen gibt nur die Geschäftsführung frei." };
  const ids = z.array(id).max(100).parse(docIds);
  const out: string[] = [];
  for (const d of ids) {
    try {
      out.push((await releaseDunning(d, "mail", u)).text);
    } catch (e) {
      out.push(e instanceof BookError ? e.message : "Fehler.");
    }
  }
  refresh();
  return { ok: out.join(" ") };
}

export async function pauseDunningAction(docId: string, form: FormData) {
  const u = await requireArea("buchhaltung");
  const days = z.coerce.number().int().min(1).max(90).catch(14).parse(form.get("days"));
  const note = z.string().trim().max(200).optional().parse((form.get("note") as string) || undefined);
  await pauseDunning(id.parse(docId), days, note ?? null, u);
  refresh();
}

export async function noDunningAction(customerId: string, value: boolean) {
  const u = await requireArea("buchhaltung");
  if (u.role !== "ADMIN") return;
  await setCustomerNoDunning(id.parse(customerId), value);
  refresh();
}
