import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookStock, CATEGORY_LABEL, fmtQty, isLow, lowStock, reorderRequest, StockError, type StockCategory } from "@/lib/stock";
import { calcProject, calcText } from "@/lib/nachkalkulation";
import { SupplierError } from "@/lib/suppliers";
import { proposeAction } from "./actions";
import type { ToolCtx } from "./tools";

// Materiallager und Nachkalkulation für Jarvis. Buchungen sind interne Daten (sichtbar, mit Name) – direkt erlaubt.
// Nachbestellen legt nur einen Anfrage-Entwurf + Freigabe-Karte an.

const str = (description: string) => ({ type: "string" as const, description });

export const STOCK_TOOLS: Anthropic.Tool[] = [
  {
    name: "lager",
    description: "Materiallager: suche (Bestand finden), niedrig (unter Mindestbestand), buchen (Entnahme/Eingang/Inventur, Entnahme möglichst auf ein Projekt), nachbestellen (Preisanfrage beim hinterlegten Lieferanten, Freigabe-Karte).",
    input_schema: {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["suche", "niedrig", "buchen", "nachbestellen"] },
        suche: str("suche: Bezeichnung/Abmessung, z. B. „Flachstahl 50x8“"),
        artikel_id: str("buchen/nachbestellen: ID aus suche"),
        art: { type: "string", enum: ["AUSGANG", "EINGANG", "INVENTUR"], description: "buchen: AUSGANG = Entnahme, EINGANG = Lieferung, INVENTUR = gezählter Bestand" },
        menge: { type: "number", description: "buchen: Menge in der Einheit des Artikels; nachbestellen: optional" },
        projekt_id: str("buchen (Entnahme): Projekt-ID aus projekte"),
        preis: { type: "number", description: "buchen (Eingang): EK netto je Einheit, optional" },
        notiz: str("optional"),
      },
      required: ["aktion"],
    },
  },
  {
    name: "nachkalkulation",
    description: "Nachkalkulation eines Projekts: Auftragswert (Lexware-Angebot) gegen Lohn (Stunden × Kostensatz), Material aus Lager, bestellte Lieferanten-Angebote, Spesen, sonstige Kosten, Ergebnis und Marge.",
    input_schema: { type: "object", properties: { projekt_id: str("Projekt-ID aus projekte") }, required: ["projekt_id"] },
  },
];

export const STOCK_TOOL_NAMES = new Set(STOCK_TOOLS.map((t) => t.name));

export async function runStockTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    if (name === "nachkalkulation") {
      const id = z.cuid().parse(i.projekt_id);
      return calcText(await calcProject(id));
    }
    const q = z
      .object({ aktion: z.enum(["suche", "niedrig", "buchen", "nachbestellen"]), suche: z.string().trim().max(80).optional(), artikel_id: z.cuid().optional(), art: z.enum(["AUSGANG", "EINGANG", "INVENTUR"]).optional(), menge: z.number().min(0).max(1_000_000).optional(), projekt_id: z.cuid().optional(), preis: z.number().min(0).max(1_000_000).optional(), notiz: z.string().max(500).optional() })
      .parse(i);
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true } });
    switch (q.aktion) {
      case "suche": {
        const words = (q.suche ?? "").split(/\s+/).filter(Boolean).slice(0, 6);
        const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
        const list = await db.stockItem.findMany({ where: { AND: words.map((w) => ({ OR: [{ name: ci(w) }, { material: ci(w) }, { articleNo: ci(w) }, { location: ci(w) }] })) }, orderBy: { name: "asc" }, take: 25, include: { supplier: { select: { name: true } } } });
        if (!list.length) return "Kein passender Lagerartikel. Neue Artikel legt man unter [Lager](/lager) an.";
        return list.map((x) => `- ${x.name}${x.material ? ` (${x.material})` : ""} · Bestand ${fmtQty(x.quantity, x.unit)}${x.minQuantity !== null ? ` · min. ${fmtQty(x.minQuantity)}` : ""}${isLow(x) ? " ⚠ nachbestellen" : ""}${x.location ? ` · ${x.location}` : ""}${x.supplier ? ` · ${x.supplier.name}` : ""} · ${CATEGORY_LABEL[x.category as StockCategory] ?? x.category} · id ${x.id}`).join("\n");
      }
      case "niedrig": {
        const low = await lowStock();
        return low.length ? `Unter Mindestbestand:\n${low.map((x) => `- ${x.name} · noch ${fmtQty(x.quantity, x.unit)} (min. ${fmtQty(x.minQuantity ?? 0)})${x.supplier ? ` · Lieferant ${x.supplier.name}` : " · kein Lieferant hinterlegt"} · id ${x.id}`).join("\n")}` : "Alles über Mindestbestand.";
      }
      case "buchen": {
        if (!q.artikel_id || !q.art || q.menge === undefined) return "Für buchen: artikel_id, art und menge angeben.";
        const r = await bookStock({ itemId: q.artikel_id, kind: q.art, qty: q.menge, projectId: q.projekt_id, price: q.preis, note: q.notiz, userName: `${user.name} (über Jarvis)` });
        const warn = isLow(r.item) ? ` Achtung: jetzt unter Mindestbestand (${fmtQty(r.item.minQuantity ?? 0)}) – nachbestellen?` : "";
        return `Gebucht: ${r.delta > 0 ? "+" : ""}${fmtQty(r.delta, r.item.unit)} ${r.item.name}. Bestand jetzt ${fmtQty(r.item.quantity, r.item.unit)}.${warn} [Artikel](/lager/${r.item.id})`;
      }
      case "nachbestellen": {
        if (!q.artikel_id) return "artikel_id fehlt.";
        const r = await reorderRequest(q.artikel_id, user, q.menge);
        const s = await db.supplier.findUniqueOrThrow({ where: { id: r.supplierId } });
        if (!s.email) return `Anfrage-Entwurf an ${s.name} angelegt, aber dort fehlt die E-Mail: [Anfrage öffnen](/lieferanten/anfrage/${r.id}).`;
        const a = await proposeAction(ctx.chatId, ctx.userId, "preisanfrage_senden", { requestId: r.id, an: s.email, betreff: r.subject, text: r.text });
        ctx.proposed.push(a.id);
        return `Nachbestellung als Preisanfrage an ${s.name} vorbereitet (noch NICHT gesendet) – Freigabe-Karte liegt unten. Ändern: [Anfrage öffnen](/lieferanten/anfrage/${r.id}).`;
      }
    }
  } catch (e) {
    if (e instanceof z.ZodError) return `Ungültige Eingabe: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof StockError || e instanceof SupplierError) return e.message;
    console.error(`[jarvis] Lager-Werkzeug ${name}:`, e);
    return "Fehler beim Lager.";
  }
  return `Unbekanntes Werkzeug ${name}.`;
}
