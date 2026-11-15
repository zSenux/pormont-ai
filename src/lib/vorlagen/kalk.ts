import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { createDraft, type Actor } from "@/lib/buchhaltung/docs";
import { steelPrices } from "@/lib/steel-prices";
import { calculate, kalkSchema, parseParams, type Kalk, type Product } from "./model";

// Angebotsvorlagen auf dem Server: Kalkulationswerte (AppSetting „VORLAGEN_KALK“), Angebot aus einer Konfiguration anlegen,
// Ansicht (JPEG aus der 3D-Vorschau) speichern. Preise rechnet immer der Server aus DB-Werten – nie aus Browser-Angaben.

const KEY = "VORLAGEN_KALK";

export class VorlagenError extends Error {}

export async function kalkValues(): Promise<Kalk> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = kalkSchema.safeParse(raw);
  return p.success ? p.data : kalkSchema.parse({});
}

export async function saveKalkValues(k: Kalk) {
  const value = JSON.stringify(kalkSchema.parse(k));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function calculateNow(product: Product, params: unknown) {
  const [steel, kalk] = await Promise.all([steelPrices(), kalkValues()]);
  return calculate(product, params, steel, kalk);
}

/** JPEG aus der 3D-Vorschau prüfen (data:image/jpeg;base64,…, max. 1,5 MB) */
export function readJpeg(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new VorlagenError("Ansicht ist kein JPEG-Bild.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 1_500_000) throw new VorlagenError("Ansicht ist zu groß.");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new VorlagenError("Ansicht ist kein JPEG-Bild.");
  return buf;
}

/**
 * Angebots-Entwurf aus einer Konfiguration: Positionen aus der Kalkulation, Konfiguration + Ansicht hängen am Angebot.
 * Fehlen Kalkulationswerte, wird nichts angelegt.
 */
export async function createQuoteFromConfig(o: { product: Product; params: unknown; customerId?: string | null; projectId?: string | null; image?: Buffer | null; baseUrl?: string | null; user: Actor }) {
  const params = parseParams(o.product, o.params);
  const c = await calculateNow(o.product, params);
  if (c.missing.length) throw new VorlagenError(`Für den Preis fehlen noch Werte: ${c.missing.join(", ")}.`);
  const doc = await createDraft(
    "ANGEBOT",
    {
      customerId: o.customerId || null,
      projectId: o.projectId || null,
      title: c.model.title,
      lines: c.lines.map((l) => ({ name: l.name, description: l.description, qty: l.qty, unit: l.unit, price: l.price, discount: 0, taxRate: 19 })),
    },
    o.user,
  );
  const config = await db.productConfig.create({
    data: {
      product: o.product,
      title: c.model.title,
      params: params as object,
      calc: { ...c, model: { ...c.model, shapes: undefined } } as object,
      image: o.image ? new Uint8Array(o.image) : null,
      token: randomBytes(18).toString("base64url"),
      baseUrl: o.baseUrl ?? null,
      docId: doc.id,
      createdById: o.user.id,
      createdBy: o.user.name,
    },
  });
  await db.salesDocEvent.create({ data: { docId: doc.id, text: `Aus Angebotsvorlage ${c.model.title} kalkuliert (${c.model.totalKg.toLocaleString("de-DE")} kg, ${c.fertigungStd.toLocaleString("de-DE")} Std. Werkstatt, ${c.montageStd.toLocaleString("de-DE")} Std. Montage)`, userName: o.user.name } });
  return { doc, config, calc: c };
}

/** Ansicht nachreichen (z. B. Angebot von Jarvis) – nur solange das Angebot ein Entwurf ist */
export async function setConfigImage(id: string, image: Buffer) {
  const cfg = await db.productConfig.findUnique({ where: { id }, select: { doc: { select: { status: true } } } });
  if (!cfg) throw new VorlagenError("Konfiguration nicht gefunden.");
  if (cfg.doc && cfg.doc.status !== "ENTWURF") throw new VorlagenError("Das Angebot ist festgeschrieben – die Ansicht bleibt wie sie ist.");
  await db.productConfig.update({ where: { id }, data: { image: new Uint8Array(image) } });
}
