import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { formatEuro } from "@/lib/berlin";
import { BookError } from "@/lib/buchhaltung/docs";
import { calculateNow, createQuoteFromConfig, VorlagenError } from "@/lib/vorlagen/kalk";
import { PRODUCT_LABEL, PRODUCTS } from "@/lib/vorlagen/model";
import type { ToolCtx } from "./tools";

// Angebotsvorlagen: Standardprodukt kalkulieren und optional als Angebots-Entwurf anlegen.
// Preise kommen nur aus den hinterlegten Werten (Stahl-Katalog €/kg, Kalkulationswerte) – nie aus Modell-Angaben.

const str = (description: string) => ({ type: "string" as const, description });

export const VORLAGEN_TOOLS: Anthropic.Tool[] = [
  {
    name: "angebotsvorlage",
    description:
      "Standardprodukt kalkulieren: Geländer, Treppe, Vordach oder Tor aus Maßen → Stückliste aus dem Stahl-Katalog, Gewicht, Arbeitszeit, Beschichtung und Angebotspreis aus den eigenen Sätzen. Mit angebot_anlegen=true entsteht ein Angebots-Entwurf mit 3D-Ansicht und Kunden-Link. Fehlen Preise/Stundensätze, sagt das Werkzeug welche – dann keinen Preis schätzen. Maße: GELAENDER laenge (m), hoehe (mm), fuellung STAEBE|QUERSTAEBE|BLECH, befestigung AUFGESETZT|SEITLICH, werkstoff STAHL|EDELSTAHL; TREPPE hoehe (Geschosshöhe mm), breite (mm), stufen GITTERROST|BLECH, gelaender KEINS|EINSEITIG|BEIDSEITIG; VORDACH breite, tiefe, hoehe (mm), eindeckung GLAS|BLECH; TOR breite, hoehe (mm), fluegel 1|2, fuellung STAEBE|BLECH, antrieb true/false. Für alle: oberflaeche ROH|VERZINKT|PULVER|DUPLEX, ral (4 Ziffern), montage true/false. Nicht genannte Werte haben sinnvolle Standards.",
    input_schema: {
      type: "object",
      properties: {
        produkt: { type: "string", enum: [...PRODUCTS] },
        masse: { type: "object", description: "Maße und Ausführung, z. B. { \"laenge\": 8.4, \"hoehe\": 1000, \"oberflaeche\": \"DUPLEX\", \"ral\": \"7016\" }" },
        angebot_anlegen: { type: "boolean", description: "true = Angebots-Entwurf anlegen (nur wenn der Nutzer das will)" },
        kunde_id: str("Kunden-ID aus kunden_suchen (optional)"),
        projekt_id: str("Projekt-ID (optional)"),
      },
      required: ["produkt"],
    },
  },
];
export const VORLAGEN_TOOL_NAMES = new Set(VORLAGEN_TOOLS.map((t) => t.name));

const eur = (n: number) => formatEuro(n);

export async function runVorlagenTool(name: string, i: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    const q = z.object({ produkt: z.enum(PRODUCTS), masse: z.record(z.string(), z.unknown()).default({}), angebot_anlegen: z.boolean().optional(), kunde_id: z.cuid().optional(), projekt_id: z.cuid().optional() }).parse(i);
    const c = await calculateNow(q.produkt, q.masse);
    const head = `${c.model.title} (${PRODUCT_LABEL[q.produkt]}):\n${c.model.specs.map((s) => `- ${s}`).join("\n")}${c.model.notes.length ? `\nHinweise: ${c.model.notes.join(" ")}` : ""}`;
    if (c.missing.length) return `${head}\n\nKein Preis möglich – es fehlen: ${c.missing.join(", ")}. Stahlpreise unter [Stahl-Katalog](/lieferanten/stahl), Stundensätze/Zeiten/Zuschläge unter [Angebotsvorlagen](/buchhaltung/vorlagen#kalk). Keinen Preis schätzen.`;
    const money = `\n\nKalkulation netto: Material ${eur(c.material)}${c.buy ? `, Zukauf ${eur(c.buy)}` : ""}${c.beschichtung ? `, Beschichtung ${eur(c.beschichtung)}` : ""}, Werkstatt ${c.fertigungStd.toLocaleString("de-DE")} Std. = ${eur(c.fertigung)}${c.montageStd ? `, Montage ${c.montageStd.toLocaleString("de-DE")} Std. + Anfahrt = ${eur(c.montage)}` : ""}, Zuschläge ${eur(c.zuschlag)} → **${eur(c.net)} netto** (${eur(Math.round(c.net * 119) / 100)} brutto).`;
    if (!q.angebot_anlegen) return `${head}${money}\nAusprobieren mit 3D-Ansicht: [Angebotsvorlagen](/buchhaltung/vorlagen?produkt=${q.produkt}).`;
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true } });
    const r = await createQuoteFromConfig({ product: q.produkt, params: q.masse, customerId: q.kunde_id, projectId: q.projekt_id, user });
    return `${head}${money}\n\nAngebots-Entwurf angelegt: [Angebot öffnen](/buchhaltung/beleg/${r.doc.id}). Beim ersten Öffnen kommt die 3D-Ansicht ins PDF; der Kunden-Link steht dort. Festschreiben/Senden nur auf Wunsch über die Freigabe.`;
  } catch (e) {
    if (e instanceof z.ZodError) return `Ungültige Eingabe: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
    if (e instanceof VorlagenError || e instanceof BookError) return e.message;
    if (e instanceof Error && /Profil/.test(e.message)) return e.message;
    console.error(`[jarvis] Vorlagen-Werkzeug ${name}:`, e);
    return "Fehler bei der Angebotsvorlage.";
  }
}
