"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/user";
import { lexwareConfigured } from "@/lib/lexware/client";
import { changeTableKind, claim, ERP_KINDS, ErpImportError, transferArticles, transferCustomers, transferProjects } from "@/lib/erp-import";

// Datenübernahme aus dem alten Programm: Übernahme nach Lexware/Jarvis nur per Klick eines Admins (mit Rückfrage im Browser)

type Result = { ok?: string; error?: string } | undefined;

export async function setTableKind(importId: string, table: string, _prev: Result, form: FormData): Promise<Result> {
  await requireAdmin();
  const kind = z.enum(ERP_KINDS).safeParse(form.get("kind"));
  if (!kind.success) return { error: "Art wählen." };
  try {
    await changeTableKind(z.cuid().parse(importId), z.string().max(120).parse(table), kind.data);
  } catch (e) {
    return { error: e instanceof ErpImportError ? e.message : "Konnte nicht geändert werden." };
  }
  revalidatePath("/datenuebernahme");
  return { ok: "Neu zugeordnet." };
}

export async function startTransfer(importId: string, what: "kunde" | "artikel" | "projekt"): Promise<Result> {
  const user = await requireAdmin();
  const id = z.cuid().parse(importId);
  const kind = z.enum(["kunde", "artikel", "projekt"]).parse(what);
  if (kind !== "projekt" && !lexwareConfigured()) return { error: "Lexware ist noch nicht verbunden (Einstellungen → Verbindungen)." };
  const open = await db.erpRecord.count({ where: { importId: id, kind, ...(kind === "projekt" ? { projectId: null } : { lexId: null }) } });
  if (!open) return { ok: "Es ist nichts mehr zu übernehmen." };
  if (!(await claim(id, kind))) return { error: "Für diese Datei läuft gerade schon eine Übernahme." };
  if (kind === "projekt") {
    const n = await transferProjects(id, user.id);
    revalidatePath("/datenuebernahme");
    return { ok: `${n} Projekte angelegt (gleichnamige wurden verknüpft).` };
  }
  after(() => (kind === "kunde" ? transferCustomers(id) : transferArticles(id)));
  revalidatePath("/datenuebernahme");
  return { ok: `Läuft im Hintergrund (${open} Einträge, ca. ${Math.ceil((open * 1.2) / 60)} Min.). Seite später neu laden.` };
}

export async function deleteImport(importId: string) {
  await requireAdmin();
  await db.erpImport.delete({ where: { id: z.cuid().parse(importId) } });
  revalidatePath("/datenuebernahme");
  redirect("/datenuebernahme");
}
