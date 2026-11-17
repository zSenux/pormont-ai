"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/user";
import { ASSUME_PAID_DAYS, changeTableKind, claim, deleteErpImport, ERP_KINDS, ErpImportError, transferArticles, transferCustomers, transferInvoices, transferProjects, syncLexwareStatus } from "@/lib/erp-import";

// Datenübernahme aus dem alten Programm: Übernahme in die Buchhaltung/Jarvis nur per Klick eines Admins (mit Rückfrage im Browser)

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

export async function startTransfer(importId: string, what: "kunde" | "artikel" | "projekt" | "rechnung" | "zahlstatus"): Promise<Result> {
  const user = await requireAdmin();
  const id = z.cuid().parse(importId);
  if (what === "zahlstatus") {
    const r = await syncLexwareStatus(user.name);
    revalidatePath("/datenuebernahme");
    revalidatePath("/buchhaltung");
    revalidatePath("/");
    return { ok: r.updated || r.dueFixed ? `${r.updated} Rechnungen auf den Zahlstatus aus Lexware gebracht${r.dueFixed ? `, bei ${r.dueFixed} die Fälligkeit (Belegdatum + 14 Tage) ergänzt` : ""}.` : "Alles stimmt schon mit Lexware überein." };
  }
  const kind = z.enum(["kunde", "artikel", "projekt", "rechnung"]).parse(what);
  const open = await db.erpRecord.count({ where: { importId: id, kind, ...(kind === "projekt" ? { projectId: null } : { lexId: null }) } });
  if (!open) return { ok: "Es ist nichts mehr zu übernehmen." };
  if (!(await claim(id, kind))) return { error: "Für diese Datei läuft gerade schon eine Übernahme." };
  if (kind === "rechnung") {
    const r = await transferInvoices(id, user.name);
    revalidatePath("/datenuebernahme");
    revalidatePath("/buchhaltung");
    return { ok: `${r.created - r.credits} Rechnungen${r.credits ? ` und ${r.credits} Stornos (als Gutschrift)` : ""} in die Buchhaltung übernommen${r.linked ? `, ${r.linked} waren schon da` : ""}${r.customers ? `, ${r.customers} fehlende Kunden angelegt` : ""}${r.synced ? `, bei ${r.synced} schon vorhandenen den Zahlstatus aus Lexware übernommen` : ""}. ${r.open} Rechnungen offen (laut Lexware bzw. jünger als ${ASSUME_PAID_DAYS} Tage ohne Zahlstatus), die übrigen bezahlt.` };
  }
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
  await deleteErpImport(z.cuid().parse(importId));
  revalidatePath("/datenuebernahme");
  redirect("/datenuebernahme");
}
