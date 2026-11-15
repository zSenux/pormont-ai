"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { todayYmd } from "@/lib/berlin";
import { BookError, payRest } from "@/lib/buchhaltung/docs";
import { setPurchasePaid } from "@/lib/buchhaltung/purchases";
import { fmtEuroCents } from "@/lib/buchhaltung/money";

// Offene Posten: Ausgangs- und Eingangsrechnungen mit einem Klick als bezahlt markieren.

type Result = { ok?: string; error?: string } | undefined;
const id = z.string().min(5).max(40);
const fail = (e: unknown): { error: string } => ({ error: e instanceof BookError ? e.message : e instanceof z.ZodError ? "Ungültige Eingabe." : "Das hat nicht geklappt." });
const done = () => {
  revalidatePath("/buchhaltung", "layout");
};

export async function payInvoiceAction(docId: string): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    const r = await payRest(id.parse(docId), { day: todayYmd() }, user);
    done();
    return { ok: `${fmtEuroCents(r.amountCents)} als bezahlt gebucht.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setPurchasePaidAction(purchaseId: string, paid: boolean): Promise<Result> {
  await requireArea("buchhaltung");
  try {
    await setPurchasePaid(id.parse(purchaseId), z.boolean().parse(paid));
    done();
    return { ok: paid ? "Als bezahlt markiert." : "Wieder offen." };
  } catch (e) {
    return fail(e);
  }
}
