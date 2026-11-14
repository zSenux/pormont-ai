"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { BookError } from "@/lib/buchhaltung/docs";
import { assignTx, autoAssign, importStatement, setIgnored, unassignTx } from "@/lib/buchhaltung/bank";

// Server-Actions für den Bankabgleich. requireArea("buchhaltung") prüft Anmeldung, Freischaltung und Recht.

type Result = { ok?: string; error?: string } | undefined;
const id = z.string().min(5).max(40);
const fail = (e: unknown): { error: string } => ({ error: e instanceof BookError ? e.message : e instanceof z.ZodError ? "Ungültige Eingabe." : "Das hat nicht geklappt." });
const done = () => {
  revalidatePath("/buchhaltung/bank");
  revalidatePath("/buchhaltung/ausgaben");
  revalidatePath("/buchhaltung");
};

export async function importStatementAction(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireArea("buchhaltung");
  const f = form.get("datei");
  if (!(f instanceof File) || !f.size) return { error: "Bitte eine Datei auswählen." };
  if (f.size > 8 * 1024 * 1024) return { error: "Die Datei ist zu groß (höchstens 8 MB)." };
  try {
    const r = await importStatement(Buffer.from(await f.arrayBuffer()), f.name, user);
    const auto = form.get("auto") === "on" ? await autoAssign(user) : 0;
    done();
    return { ok: `${r.added} neue Umsätze übernommen${r.total > r.added ? `, ${r.total - r.added} waren schon da` : ""}${auto ? ` · ${auto} automatisch zugeordnet` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function assignTxAction(txId: string, kind: "doc" | "purchase", targetId: string): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await assignTx(id.parse(txId), { kind: z.enum(["doc", "purchase"]).parse(kind), id: id.parse(targetId) }, user);
  } catch (e) {
    return fail(e);
  }
  done();
}

export async function unassignTxAction(txId: string): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    await unassignTx(id.parse(txId), user);
  } catch (e) {
    return fail(e);
  }
  done();
}

export async function ignoreTxAction(txId: string, ignored: boolean): Promise<Result> {
  await requireArea("buchhaltung");
  try {
    await setIgnored(id.parse(txId), z.boolean().parse(ignored));
  } catch (e) {
    return fail(e);
  }
  done();
}

export async function autoAssignAction(): Promise<Result> {
  const user = await requireArea("buchhaltung");
  try {
    const n = await autoAssign(user);
    done();
    return n ? { ok: `${n} Umsätze zugeordnet.` } : { error: "Keine sicheren Treffer gefunden." };
  } catch (e) {
    return fail(e);
  }
}
