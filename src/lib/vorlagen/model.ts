import { z } from "zod";
import { calcWeight, findProfile, pricePerKg, STEEL_ONLY, type PriceTable, type SteelMaterial, type SteelProfile } from "@/lib/steel";

// Angebotsvorlagen für Standardprodukte (Geländer, Treppe, Vordach, Tor): aus wenigen Maßen entsteht ein Modell mit
// Stückliste (Profile aus dem Stahl-Katalog) und 3D-Teilen. Dieselbe Funktion rechnet im Browser (Live-Vorschau),
// auf dem Server (Angebot anlegen) und in der Kunden-Ansicht (/3d/…, dort ohne Preise).
// Keine Preise im Code: €/kg kommen aus dem Stahl-Katalog, Stundensätze/Zeiten/Zuschläge aus den Kalkulationswerten.
// Ohne server-only, damit Rechner und 3D-Ansicht dieselben Werte nutzen.

export const PRODUCTS = ["GELAENDER", "TREPPE", "VORDACH", "TOR"] as const;
export type Product = (typeof PRODUCTS)[number];
export const PRODUCT_LABEL: Record<Product, string> = { GELAENDER: "Geländer", TREPPE: "Treppe", VORDACH: "Vordach", TOR: "Tor" };
/** Bezugsgröße für die Arbeitszeit je Produkt */
export const PRODUCT_UNIT: Record<Product, { unit: string; label: string }> = {
  GELAENDER: { unit: "lfm", label: "je laufenden Meter" },
  TREPPE: { unit: "Stufe", label: "je Stufe" },
  VORDACH: { unit: "m²", label: "je m² Dachfläche" },
  TOR: { unit: "m²", label: "je m² Torfläche" },
};

export const SURFACES = ["ROH", "VERZINKT", "PULVER", "DUPLEX"] as const;
export type Surface = (typeof SURFACES)[number];
export const SURFACE_LABEL: Record<Surface, string> = {
  ROH: "ohne Beschichtung (roh/grundiert)",
  VERZINKT: "feuerverzinkt",
  PULVER: "pulverbeschichtet",
  DUPLEX: "feuerverzinkt + pulverbeschichtet",
};

/** Gängige RAL-Farben fürs Pulverbeschichten (Farbton nur zur Darstellung) */
export const RAL: Record<string, { name: string; hex: string }> = {
  "7016": { name: "Anthrazitgrau", hex: "#383e42" },
  "9005": { name: "Tiefschwarz", hex: "#151517" },
  "7030": { name: "Steingrau", hex: "#939388" },
  "7035": { name: "Lichtgrau", hex: "#cbd0cc" },
  "9006": { name: "Weißaluminium", hex: "#a1a1a0" },
  "9007": { name: "Graualuminium", hex: "#8f8f8c" },
  "9010": { name: "Reinweiß", hex: "#f1ede1" },
  "6005": { name: "Moosgrün", hex: "#0f4336" },
  "5010": { name: "Enzianblau", hex: "#13447c" },
  "3000": { name: "Feuerrot", hex: "#a72920" },
  "8017": { name: "Schokoladenbraun", hex: "#44322d" },
};

// ---------- Eingaben je Produkt ----------

const profileName = (fallback: string) => z.string().trim().max(60).default(fallback).refine((s) => findProfile(s) !== null, "Profil nicht erkannt (z. B. „Flachstahl 40x12“, „Rundrohr 42,4x2,6“)");
const common = {
  oberflaeche: z.enum(SURFACES).default("DUPLEX"),
  ral: z.string().regex(/^\d{4}$/).default("7016"),
  montage: z.boolean().default(true),
};

export const railingSchema = z.object({
  laenge: z.number().min(0.5).max(100).default(6),
  hoehe: z.number().int().min(800).max(1300).default(1000),
  pfostenAbstand: z.number().int().min(600).max(2000).default(1200),
  fuellung: z.enum(["STAEBE", "QUERSTAEBE", "BLECH"]).default("STAEBE"),
  befestigung: z.enum(["AUFGESETZT", "SEITLICH"]).default("AUFGESETZT"),
  werkstoff: z.enum(["STAHL", "EDELSTAHL"]).default("STAHL"),
  pfosten: profileName("Flachstahl 50x12"),
  handlauf: profileName("Rundrohr 42,4x2,6"),
  fuellstab: profileName("Vierkantstahl 12"),
  gurt: profileName("Flachstahl 40x8"),
  ...common,
});

export const stairSchema = z.object({
  hoehe: z.number().int().min(400).max(6000).default(2800),
  breite: z.number().int().min(600).max(2000).default(1000),
  stufen: z.enum(["BLECH", "GITTERROST"]).default("GITTERROST"),
  wange: profileName("Flachstahl 250x12"),
  gelaender: z.enum(["KEINS", "EINSEITIG", "BEIDSEITIG"]).default("EINSEITIG"),
  ...common,
});

export const canopySchema = z.object({
  breite: z.number().int().min(1000).max(8000).default(2400),
  tiefe: z.number().int().min(600).max(2500).default(1200),
  hoehe: z.number().int().min(2000).max(4000).default(2500),
  eindeckung: z.enum(["GLAS", "BLECH"]).default("GLAS"),
  rahmen: profileName("Rechteckrohr 100x50x4"),
  zugstange: profileName("Rundstahl 16"),
  ...common,
});

export const gateSchema = z.object({
  breite: z.number().int().min(800).max(6000).default(3000),
  hoehe: z.number().int().min(800).max(2500).default(1400),
  fluegel: z.union([z.literal(1), z.literal(2)]).default(2),
  fuellung: z.enum(["STAEBE", "BLECH"]).default("STAEBE"),
  rahmen: profileName("Quadratrohr 60x60x3"),
  fuellstab: profileName("Vierkantstahl 16"),
  pfosten: profileName("Quadratrohr 100x100x4"),
  antrieb: z.boolean().default(false),
  ...common,
});

export const PARAM_SCHEMA = { GELAENDER: railingSchema, TREPPE: stairSchema, VORDACH: canopySchema, TOR: gateSchema } as const;
export type RailingParams = z.infer<typeof railingSchema>;
export type StairParams = z.infer<typeof stairSchema>;
export type CanopyParams = z.infer<typeof canopySchema>;
export type GateParams = z.infer<typeof gateSchema>;
export type ParamsOf<P extends Product> = z.infer<(typeof PARAM_SCHEMA)[P]>;
export type AnyParams = RailingParams | StairParams | CanopyParams | GateParams;

export const FILL_LABEL: Record<string, string> = { STAEBE: "senkrechte Stäbe", QUERSTAEBE: "waagerechte Stäbe", BLECH: "Blechfüllung (Lochblech 3 mm)" };

/** Eingaben prüfen und mit Standardwerten auffüllen */
export function parseParams(product: Product, raw: unknown) {
  return PARAM_SCHEMA[product].parse(raw ?? {}) as AnyParams;
}
export const defaultParams = (product: Product) => PARAM_SCHEMA[product].parse({}) as AnyParams;

// ---------- Modell: Teile + 3D ----------

export type V3 = [number, number, number];
export type Section = { type: "rect"; w: number; h: number } | { type: "round"; d: number };
/** 3D-Teile in Metern: x = Länge/Breite, y = oben, z = Tiefe */
export type Shape =
  | { kind: "bar"; a: V3; b: V3; section: Section; side?: V3 }
  | { kind: "box"; center: V3; size: V3; tone?: "glass" | "grate" | "wall" | "floor" };

export type Part = {
  label: string;
  profile: string;
  material: SteelMaterial;
  count: number;
  /** je Stück in m (Bleche: Länge) */
  lengthM: number;
  /** nur Bleche: Breite je Stück in m */
  widthM?: number;
  kg: number;
  /** Oberfläche zum Beschichten in m² */
  m2: number;
  family: SteelProfile["family"];
};
export type Buy = { key: "glas" | "gitterrost" | "beschlag" | "antrieb"; label: string; qty: number; unit: string };

export type Model = {
  product: Product;
  title: string;
  /** Kurzbeschreibung (Positionstext) */
  specs: string[];
  /** Bezugsmenge für die Arbeitszeit (lfm, Stufen, m²) */
  units: number;
  parts: Part[];
  buy: Buy[];
  shapes: Shape[];
  totalKg: number;
  totalM2: number;
  /** Farbe der Ansicht */
  color: string;
  /** Hinweise (z. B. Steigungsverhältnis) */
  notes: string[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const de = (n: number, d = 2) => n.toLocaleString("de-DE", { maximumFractionDigits: d });
const mm = (n: number) => `${Math.round(n).toLocaleString("de-DE")} mm`;

/** Querschnitt für die 3D-Ansicht (m) */
function sectionOf(p: SteelProfile): Section {
  const d = p.dims.map((v) => v / 1000);
  switch (p.family) {
    case "RD": case "RO": return { type: "round", d: d[0] };
    case "FL": return { type: "rect", w: d[1], h: d[0] };
    case "VK": return { type: "rect", w: d[0], h: d[0] };
    case "QR": case "RR": return { type: "rect", w: d[1], h: d[0] };
    case "L": return { type: "rect", w: d[0], h: d[0] };
    case "BL": return { type: "rect", w: d[0], h: 0.1 };
    default: return { type: "rect", w: d[1], h: d[0] };
  }
}

/** Abwicklung (Umfang) in m je m Profil, Bleche: beide Seiten */
function perimeterOf(p: SteelProfile) {
  const d = p.dims.map((v) => v / 1000);
  switch (p.family) {
    case "FL": return 2 * (d[0] + d[1]);
    case "RD": case "RO": return Math.PI * d[0];
    case "VK": return 4 * d[0];
    case "QR": case "RR": return 2 * (d[0] + d[1]);
    case "L": return 4 * d[0];
    case "BL": return 2;
    default: return 2 * d[0] + 4 * d[1];
  }
}

/** Abmessung quer zur Achse (für Abstände) */
const thick = (p: SteelProfile) => {
  const s = sectionOf(p);
  return s.type === "round" ? s.d : s.w;
};
const wide = (p: SteelProfile) => {
  const s = sectionOf(p);
  return s.type === "round" ? s.d : s.h;
};

class Builder {
  parts = new Map<string, Part>();
  shapes: Shape[] = [];
  buy: Buy[] = [];
  constructor(public material: SteelMaterial) {}

  private add(label: string, p: SteelProfile, lengthM: number, widthM?: number) {
    const material: SteelMaterial = STEEL_ONLY.has(p.family) ? "STAHL" : this.material;
    const key = `${label}|${p.key}|${Math.round(lengthM * 1000)}|${widthM ? Math.round(widthM * 1000) : ""}`;
    const c = calcWeight({ profile: p, material, laengeM: lengthM, breiteM: widthM, stueck: 1 });
    const m2 = p.family === "BL" ? 2 * lengthM * (widthM ?? 1) : perimeterOf(p) * lengthM;
    const cur = this.parts.get(key);
    if (cur) {
      cur.count += 1;
      cur.kg = r2(cur.kg + c.totalKg);
      cur.m2 = r3(cur.m2 + m2);
    } else this.parts.set(key, { label, profile: p.name, material, count: 1, lengthM: r3(lengthM), widthM: widthM ? r3(widthM) : undefined, kg: c.totalKg, m2: r3(m2), family: p.family });
  }

  bar(label: string, p: SteelProfile, a: V3, b: V3, side?: V3) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 0.005) return;
    this.add(label, p, len);
    this.shapes.push({ kind: "bar", a, b, section: sectionOf(p), side });
  }

  /** Blech: Größe x/y/z in m (die dünnste Seite ist die Dicke) */
  plate(label: string, p: SteelProfile, center: V3, size: V3, tone?: "grate") {
    const [a, b] = [...size].sort((x, y) => y - x);
    this.add(label, p, a, b);
    this.shapes.push({ kind: "box", center, size, tone });
  }

  /** Zukaufteil (nicht aus dem Stahl-Katalog), optional mit 3D */
  purchase(b: Buy, shape?: Shape) {
    const cur = this.buy.find((x) => x.key === b.key && x.label === b.label);
    if (cur) cur.qty = r3(cur.qty + b.qty);
    else this.buy.push({ ...b, qty: r3(b.qty) });
    if (shape) this.shapes.push(shape);
  }

  scenery(s: Shape) {
    this.shapes.push(s);
  }
}

const prof = (name: string) => {
  const p = findProfile(name);
  if (!p) throw new Error(`Profil „${name}“ nicht erkannt.`);
  return p;
};

function surfaceText(p: { oberflaeche: Surface; ral: string }, material: SteelMaterial) {
  if (material === "EDELSTAHL") return "Edelstahl 1.4301, Oberfläche geschliffen";
  const ral = RAL[p.ral];
  const color = `RAL ${p.ral}${ral ? ` ${ral.name}` : ""}`;
  return p.oberflaeche === "PULVER" || p.oberflaeche === "DUPLEX" ? `${SURFACE_LABEL[p.oberflaeche]} ${color}` : SURFACE_LABEL[p.oberflaeche];
}

function colorOf(p: { oberflaeche: Surface; ral: string }, material: SteelMaterial) {
  if (material === "EDELSTAHL") return "#c9ccd0";
  if (p.oberflaeche === "PULVER" || p.oberflaeche === "DUPLEX") return RAL[p.ral]?.hex ?? "#383e42";
  if (p.oberflaeche === "VERZINKT") return "#a9b0b5";
  return "#4a4f54";
}

// Geländer: Pfosten im Abstand ≤ Pfostenabstand, Handlauf oben, Ober-/Untergurt, Füllung mit ≤ 12 cm lichtem Abstand
function railingParts(B: Builder, p: { laenge: number; hoehe: number; pfostenAbstand: number; fuellung: string; befestigung: string; pfosten: string; handlauf: string; fuellstab: string; gurt: string }, at: { x0: number; y0: number; z: number; slope?: number } = { x0: 0, y0: 0, z: 0 }) {
  const post = prof(p.pfosten);
  const rail = prof(p.handlauf);
  const bar = prof(p.fuellstab);
  const belt = prof(p.gurt);
  const L = p.laenge;
  const H = p.hoehe / 1000;
  const n = Math.max(2, Math.ceil(L / (p.pfostenAbstand / 1000)) + 1);
  const xs = Array.from({ length: n }, (_, i) => at.x0 + (L * i) / (n - 1));
  const railR = wide(rail) / 2;
  const topY = H - railR;
  const lowY = 0.1;
  const highY = H - 0.1;
  const plateP = prof("Blech 10");
  for (const x of xs) {
    if (p.befestigung === "SEITLICH") {
      B.bar("Pfosten", post, [x, at.y0 - 0.2, at.z], [x, at.y0 + topY, at.z]);
      B.plate("Seitenplatte", plateP, [x, at.y0 - 0.12, at.z - thick(post) / 2 - 0.005], [0.12, 0.16, 0.01]);
    } else {
      B.bar("Pfosten", post, [x, at.y0 + 0.01, at.z], [x, at.y0 + topY, at.z]);
      B.plate("Fußplatte", plateP, [x, at.y0 + 0.005, at.z], [0.12, 0.01, 0.12]);
    }
  }
  B.bar("Handlauf", rail, [at.x0 - 0.02, at.y0 + H - railR, at.z], [at.x0 + L + 0.02, at.y0 + H - railR, at.z]);
  B.bar("Untergurt", belt, [at.x0, at.y0 + lowY, at.z], [at.x0 + L, at.y0 + lowY, at.z]);
  if (p.fuellung !== "QUERSTAEBE") B.bar("Obergurt", belt, [at.x0, at.y0 + highY, at.z], [at.x0 + L, at.y0 + highY, at.z]);
  const pw = wide(post);
  if (p.fuellung === "STAEBE") {
    const d = wide(bar);
    for (let i = 0; i < n - 1; i++) {
      const w = xs[i + 1] - xs[i] - pw;
      const k = Math.max(0, Math.ceil((w - 0.12) / (0.12 + d)));
      const gap = (w - k * d) / (k + 1);
      for (let j = 0; j < k; j++) {
        const x = xs[i] + pw / 2 + gap * (j + 1) + d * j + d / 2;
        B.bar("Füllstab", bar, [x, at.y0 + lowY + wide(belt) / 2, at.z], [x, at.y0 + highY - wide(belt) / 2, at.z]);
      }
    }
  } else if (p.fuellung === "QUERSTAEBE") {
    const d = wide(bar);
    const span = topY - railR - lowY - wide(belt) / 2;
    const k = Math.max(0, Math.ceil((span - 0.12) / (0.12 + d)));
    const gap = (span - k * d) / (k + 1);
    for (let j = 0; j < k; j++) {
      const y = at.y0 + lowY + wide(belt) / 2 + gap * (j + 1) + d * j + d / 2;
      B.bar("Querstab", bar, [at.x0, y, at.z], [at.x0 + L, y, at.z]);
    }
  } else {
    const sheet = prof("Blech 3");
    for (let i = 0; i < n - 1; i++) {
      const w = xs[i + 1] - xs[i] - pw - 0.02;
      const h = highY - lowY - wide(belt) - 0.02;
      B.plate("Lochblech-Füllung", sheet, [(xs[i] + xs[i + 1]) / 2, at.y0 + (lowY + highY) / 2, at.z], [w, h, 0.003]);
    }
  }
  return { posts: n, spacing: L / (n - 1) };
}

function buildRailing(p: RailingParams): Model {
  const B = new Builder(p.werkstoff);
  const r = railingParts(B, p);
  B.scenery({ kind: "box", center: [p.laenge / 2, -0.1, 0.3], size: [p.laenge + 0.6, 0.2, 1.2], tone: "floor" });
  const mat = p.werkstoff;
  const specs = [
    `Länge ${de(p.laenge)} m, Höhe ${mm(p.hoehe)} (Oberkante Handlauf)`,
    `${r.posts} Pfosten ${p.pfosten}, Abstand ca. ${de(r.spacing)} m, ${p.befestigung === "SEITLICH" ? "seitlich an Stirnseite/Wange montiert" : "aufgesetzt mit Fußplatten 120 x 120 x 10 mm"}`,
    `Handlauf ${p.handlauf}, Gurte ${p.gurt}`,
    `Füllung: ${FILL_LABEL[p.fuellung]}${p.fuellung !== "BLECH" ? ` ${p.fuellstab}` : ""}${p.fuellung === "STAEBE" ? ", lichter Abstand max. 12 cm" : ""}`,
    `Oberfläche: ${surfaceText(p, mat)}`,
  ];
  const notes: string[] = [];
  if (p.fuellung === "QUERSTAEBE") notes.push("Waagerechte Stäbe sind leiterartig – wo Kinder sein können (Wohnhaus, Kita, Schule), nur senkrechte Stäbe oder Blech.");
  if (p.hoehe < 900) notes.push("Unter 90 cm Geländerhöhe – Landesbauordnung prüfen (in der Regel 90 cm, ab 12 m Absturzhöhe 110 cm).");
  return finish(B, { product: "GELAENDER", title: `${mat === "EDELSTAHL" ? "Edelstahl-" : "Stahl-"}Geländer, ${de(p.laenge)} m`, specs, units: p.laenge, color: colorOf(p, mat), notes });
}

/** Steigungsverhältnis: Stufenzahl so, dass Steigung ≈ 17,5 cm und Schrittmaß 2s + a = 63 cm */
export function stairGeometry(hoeheMm: number) {
  const n = Math.max(2, Math.round(hoeheMm / 175));
  const s = hoeheMm / n;
  const a = Math.min(300, Math.max(230, 630 - 2 * s));
  const treads = n - 1;
  return { steigungen: n, steigung: s, auftritt: a, stufen: treads, lauflaenge: treads * a, winkel: (Math.atan(s / a) * 180) / Math.PI };
}

function buildStair(p: StairParams): Model {
  const B = new Builder("STAHL");
  const g = stairGeometry(p.hoehe);
  const H = p.hoehe / 1000;
  const W = p.breite / 1000;
  const s = g.steigung / 1000;
  const a = g.auftritt / 1000;
  const run = g.lauflaenge / 1000;
  const wange = prof(p.wange);
  const wt = thick(wange);
  const wh = wide(wange);
  const cos = a / Math.hypot(a, s);
  // Wangen: Mittellinie parallel zur Stufenvorderkante, oben bis Austritt
  const dy = wh / 2 / cos - 0.03;
  const zs = [-wt / 2, W + wt / 2];
  for (const z of zs) B.bar("Wange", wange, [0.05, s - dy + 0.05 * (s / a), z], [run + 0.05, H - dy + 0.05 * (s / a), z]);
  const plateP = prof("Blech 10");
  for (const z of zs) {
    B.plate("Fuß-/Kopfplatte", plateP, [0.15, 0.005, z], [0.2, 0.01, 0.15]);
    B.plate("Fuß-/Kopfplatte", plateP, [run + 0.06, H - 0.1, z], [0.01, 0.2, 0.15]);
  }
  const angle = prof("Winkel 50x5");
  for (let i = 1; i <= g.stufen; i++) {
    const y = s * i;
    const x0 = (i - 1) * a;
    if (p.stufen === "GITTERROST") {
      B.purchase({ key: "gitterrost", label: `Gitterroststufe ${p.breite} x ${Math.round(g.auftritt + 30)} mm mit Rutschhemmung und Anschweißplatten`, qty: 1, unit: "Stk" }, { kind: "box", center: [x0 + a / 2, y - 0.015, W / 2], size: [a + 0.03, 0.03, W], tone: "grate" });
    } else {
      B.plate("Stufenblech (Tränenblech 5 mm, abgekantet)", prof("Blech 5"), [x0 + a / 2, y - 0.0025, W / 2], [a + 0.03 + 0.08, 0.005, W]);
      for (const z of [0.03, W - 0.03]) B.bar("Stufenwinkel", angle, [x0 + 0.03, y - 0.03, z], [x0 + a, y - 0.03, z]);
    }
  }
  const sides = p.gelaender === "BEIDSEITIG" ? [zs[0] - wt / 2 - 0.03, zs[1] + wt / 2 + 0.03] : p.gelaender === "EINSEITIG" ? [zs[1] + wt / 2 + 0.03] : [];
  const post = prof("Flachstahl 50x12");
  const rail = prof("Rundrohr 42,4x2,6");
  const knee = prof("Rundstahl 16");
  const slope = s / a;
  for (const z of sides) {
    const n = Math.max(2, Math.ceil(run / 1.2) + 1);
    const xs = Array.from({ length: n }, (_, i) => 0.1 + ((run - 0.1) * i) / (n - 1));
    for (const x of xs) {
      const yb = x * slope + s - 0.1;
      B.bar("Geländerpfosten", post, [x, yb, z], [x, yb + 1.0, z]);
    }
    const yAt = (x: number) => x * slope + s;
    B.bar("Handlauf", rail, [xs[0], yAt(xs[0]) + 0.9, z], [xs[n - 1], yAt(xs[n - 1]) + 0.9, z]);
    for (const h of [0.35, 0.62]) B.bar("Kniestab", knee, [xs[0], yAt(xs[0]) + h, z], [xs[n - 1], yAt(xs[n - 1]) + h, z]);
  }
  B.scenery({ kind: "box", center: [run / 2, -0.1, W / 2], size: [run + 2, 0.2, W + 1], tone: "floor" });
  B.scenery({ kind: "box", center: [run + 0.6, H - 0.1, W / 2], size: [1.0, 0.2, W + 1], tone: "floor" });
  const notes: string[] = [];
  if (g.winkel > 45) notes.push(`Steigungswinkel ${de(g.winkel, 1)}° – für Wohngebäude zu steil (DIN 18065), Grundriss prüfen.`);
  const specs = [
    `Gerade Wangentreppe, Geschosshöhe ${mm(p.hoehe)}, Laufbreite ${mm(p.breite)}`,
    `${g.steigungen} Steigungen à ${de(g.steigung, 1)} mm, Auftritt ${de(g.auftritt, 0)} mm, Lauflänge ca. ${mm(g.lauflaenge)} (${de(g.winkel, 1)}°)`,
    `Wangen ${p.wange}, ${p.stufen === "GITTERROST" ? `${g.stufen} Gitterroststufen mit rutschhemmender Vorderkante` : `${g.stufen} Stufen aus Tränenblech 5 mm, abgekantet, auf Winkeln`}`,
    p.gelaender === "KEINS" ? "ohne Geländer" : `Geländer ${p.gelaender === "BEIDSEITIG" ? "beidseitig" : "einseitig"}: Flachstahlpfosten, Handlauf Rundrohr 42,4 mm, 2 Kniestäbe`,
    `Oberfläche: ${surfaceText(p, "STAHL")}`,
  ];
  return finish(B, { product: "TREPPE", title: `Stahltreppe, ${g.steigungen} Steigungen`, specs, units: g.stufen, color: colorOf(p, "STAHL"), notes });
}

function buildCanopy(p: CanopyParams): Model {
  const B = new Builder("STAHL");
  const Bw = p.breite / 1000;
  const T = p.tiefe / 1000;
  const Y = p.hoehe / 1000;
  const frame = prof(p.rahmen);
  const rod = prof(p.zugstange);
  const fh = wide(frame);
  const fw = thick(frame);
  const yc = Y + fh / 2;
  // Rahmen: Wandträger, Stirnträger, Seitenträger, Rippen ≤ 80 cm
  B.bar("Wandträger", frame, [0, yc, fw / 2 + 0.01], [Bw, yc, fw / 2 + 0.01]);
  B.bar("Stirnträger", frame, [0, yc, T - fw / 2], [Bw, yc, T - fw / 2]);
  const ribs = Math.max(2, Math.ceil(Bw / 0.8) + 1);
  for (let i = 0; i < ribs; i++) {
    const x = fw / 2 + ((Bw - fw) * i) / (ribs - 1);
    B.bar(i === 0 || i === ribs - 1 ? "Seitenträger" : "Rippe", frame, [x, yc, fw + 0.01], [x, yc, T - fw], [1, 0, 0]);
  }
  // Zugstangen mit Wandkonsolen
  const rods = Bw <= 3 ? 2 : Math.ceil(Bw / 2) + 1;
  const plateP = prof("Blech 10");
  for (let i = 0; i < rods; i++) {
    const x = 0.25 + ((Bw - 0.5) * i) / (rods - 1);
    B.bar("Zugstange mit Gabelköpfen", rod, [x, Y + 0.85, 0.02], [x, yc + fh / 2 + 0.03, T * 0.85]);
    B.plate("Wandkonsole", plateP, [x, Y + 0.85, 0.005], [0.15, 0.2, 0.01]);
  }
  for (const x of [0.1, Bw - 0.1]) B.plate("Wandplatte", plateP, [x, yc, 0.005], [0.18, 0.25, 0.01]);
  const area = r3(Bw * T);
  if (p.eindeckung === "GLAS") {
    B.purchase({ key: "glas", label: "VSG-Glas 2 x 8 mm, Kanten geschliffen, mit Glashaltern", qty: area, unit: "m²" }, { kind: "box", center: [Bw / 2, yc + fh / 2 + 0.012, T / 2], size: [Bw - 0.02, 0.017, T - 0.02], tone: "glass" });
  } else {
    B.plate("Eindeckung Blech 3 mm", prof("Blech 3"), [Bw / 2, yc + fh / 2 + 0.0015, T / 2], [Bw, 0.003, T]);
  }
  B.scenery({ kind: "box", center: [Bw / 2, (Y + 1.5) / 2, -0.1], size: [Bw + 2, Y + 1.5, 0.2], tone: "wall" });
  B.scenery({ kind: "box", center: [Bw / 2, -0.1, T / 2 + 0.3], size: [Bw + 2, 0.2, T + 1.6], tone: "floor" });
  const specs = [
    `Vordach ${mm(p.breite)} breit, ${mm(p.tiefe)} Auskragung, Unterkante ca. ${mm(p.hoehe)} über Boden`,
    `Rahmen aus ${p.rahmen} mit ${ribs - 2} Rippen, ${rods} Zugstangen ${p.zugstange} mit Gabelköpfen und Wandkonsolen`,
    p.eindeckung === "GLAS" ? `Eindeckung VSG-Glas 2 x 8 mm (${de(area)} m²)` : `Eindeckung Stahlblech 3 mm (${de(area)} m²)`,
    `Oberfläche: ${surfaceText(p, "STAHL")}`,
    "Befestigung an tragfähigem Mauerwerk/Beton mit Verbundankern (Statik nach Prüfung des Untergrunds)",
  ];
  return finish(B, { product: "VORDACH", title: `Vordach ${de(Bw)} x ${de(T)} m${p.eindeckung === "GLAS" ? " mit Glas" : ""}`, specs, units: area, color: colorOf(p, "STAHL"), notes: ["Schnee-/Windlast und Dübel immer mit Statik prüfen – die Kalkulation ersetzt keine Statik."] });
}

function buildGate(p: GateParams): Model {
  const B = new Builder("STAHL");
  const W = p.breite / 1000;
  const H = p.hoehe / 1000;
  const frame = prof(p.rahmen);
  const bar = prof(p.fuellstab);
  const post = prof(p.pfosten);
  const pw = wide(post);
  const fw = wide(frame);
  const clear = 0.05;
  for (const x of [-pw / 2 - 0.01, W + pw / 2 + 0.01]) {
    B.bar("Torpfosten (einbetoniert)", post, [x, -0.6, 0], [x, H + clear + 0.05, 0]);
    B.plate("Pfostenkappe", prof("Blech 3"), [x, H + clear + 0.0515, 0], [pw, 0.003, pw]);
  }
  const leaves = p.fluegel;
  const lw = (W - 0.02 * (leaves + 1)) / leaves;
  for (let l = 0; l < leaves; l++) {
    const x0 = 0.02 + l * (lw + 0.02);
    const y0 = clear;
    const y1 = clear + H;
    B.bar("Rahmen senkrecht", frame, [x0 + fw / 2, y0, 0], [x0 + fw / 2, y1, 0]);
    B.bar("Rahmen senkrecht", frame, [x0 + lw - fw / 2, y0, 0], [x0 + lw - fw / 2, y1, 0]);
    B.bar("Rahmen waagerecht", frame, [x0 + fw, y0 + fw / 2, 0], [x0 + lw - fw, y0 + fw / 2, 0]);
    B.bar("Rahmen waagerecht", frame, [x0 + fw, y1 - fw / 2, 0], [x0 + lw - fw, y1 - fw / 2, 0]);
    const inner = lw - 2 * fw;
    if (p.fuellung === "STAEBE") {
      const d = wide(bar);
      const k = Math.max(0, Math.ceil((inner - 0.12) / (0.12 + d)));
      const gap = (inner - k * d) / (k + 1);
      for (let j = 0; j < k; j++) {
        const x = x0 + fw + gap * (j + 1) + d * j + d / 2;
        B.bar("Füllstab", bar, [x, y0 + fw, 0], [x, y1 - fw, 0]);
      }
      B.bar("Querriegel", prof("Flachstahl 40x8"), [x0 + fw, (y0 + y1) / 2 - 0.15, 0.02], [x0 + lw - fw, (y0 + y1) / 2 - 0.15, 0.02]);
    } else {
      B.plate("Füllung Blech 3 mm", prof("Blech 3"), [x0 + lw / 2, (y0 + y1) / 2, 0], [inner, H - 2 * fw, 0.003]);
    }
  }
  B.purchase({ key: "beschlag", label: "Beschlagsatz je Flügel (Bänder, Schloss, Drücker, Bodenriegel)", qty: leaves, unit: "Satz" });
  if (p.antrieb) B.purchase({ key: "antrieb", label: "Drehtorantrieb mit Steuerung und 2 Handsendern", qty: 1, unit: "Stk" });
  B.scenery({ kind: "box", center: [W / 2, -0.1, 0], size: [W + 2, 0.2, 2], tone: "floor" });
  const area = r3(W * H);
  const specs = [
    `${leaves === 2 ? "Zweiflügeliges" : "Einflügeliges"} Drehtor, lichte Durchfahrt ${mm(p.breite)}, Höhe ${mm(p.hoehe)}`,
    `Rahmen ${p.rahmen}, ${p.fuellung === "STAEBE" ? `Füllung senkrechte Stäbe ${p.fuellstab}, lichter Abstand max. 12 cm` : "Füllung Stahlblech 3 mm"}`,
    `2 Torpfosten ${p.pfosten} zum Einbetonieren (ca. 60 cm), mit Kappen`,
    `Beschläge: Bänder, Schloss mit Drücker, Bodenriegel${p.antrieb ? "; Drehtorantrieb mit Steuerung und 2 Handsendern" : ""}`,
    `Oberfläche: ${surfaceText(p, "STAHL")}`,
  ];
  return finish(B, { product: "TOR", title: `${leaves === 2 ? "Zweiflügeliges" : "Einflügeliges"} Tor ${de(W)} x ${de(H)} m`, specs, units: area, color: colorOf(p, "STAHL"), notes: [] });
}

function finish(B: Builder, m: Omit<Model, "parts" | "buy" | "shapes" | "totalKg" | "totalM2">): Model {
  const parts = [...B.parts.values()];
  const totalKg = r2(parts.reduce((s, x) => s + x.kg, 0));
  const totalM2 = r2(parts.reduce((s, x) => s + x.m2, 0));
  return { ...m, specs: [...m.specs, `Gewicht ca. ${de(totalKg, 0)} kg`], parts, buy: B.buy, shapes: B.shapes, totalKg, totalM2 };
}

export function buildModel(product: Product, params: unknown): Model {
  const p = parseParams(product, params);
  switch (product) {
    case "GELAENDER": return buildRailing(p as RailingParams);
    case "TREPPE": return buildStair(p as StairParams);
    case "VORDACH": return buildCanopy(p as CanopyParams);
    case "TOR": return buildGate(p as GateParams);
  }
}

// ---------- Kalkulation ----------

const num = z.number().finite().min(0).max(1_000_000).nullable().default(null);
const pct = z.number().finite().min(0).max(500).nullable().default(null);
const hours = z.object({ fertigungFix: num, fertigungJe: num, montageFix: num, montageJe: num }).prefault({});

/** Kalkulationswerte des Betriebs – nichts davon ist vorbelegt (AppSetting „VORLAGEN_KALK“) */
export const kalkSchema = z.object({
  stundensatzWerkstatt: num,
  stundensatzMontage: num,
  /** Pulverbeschichten € je m² */
  pulverM2: num,
  /** Verschnitt auf das Stahlgewicht in % */
  verschnitt: pct,
  /** Zuschlag auf Material und Zukaufteile in % */
  materialZuschlag: pct,
  /** Gemeinkosten, Wagnis und Gewinn auf alles in % */
  gewinnZuschlag: pct,
  /** Anfahrt je Montage pauschal € */
  anfahrt: num,
  glasM2: num,
  gitterrostStufe: num,
  beschlagFluegel: num,
  torantrieb: num,
  zeiten: z.object({ GELAENDER: hours, TREPPE: hours, VORDACH: hours, TOR: hours }).prefault({}),
  stand: z.string().max(40).nullable().default(null),
});
export type Kalk = z.infer<typeof kalkSchema>;

export const KALK_LABEL: Record<Exclude<keyof Kalk, "zeiten" | "stand">, string> = {
  stundensatzWerkstatt: "Stundensatz Werkstatt (€/Std.)",
  stundensatzMontage: "Stundensatz Montage (€/Std.)",
  pulverM2: "Pulverbeschichten (€/m²)",
  verschnitt: "Verschnitt (%)",
  materialZuschlag: "Materialzuschlag (%)",
  gewinnZuschlag: "Gemeinkosten + Gewinn (%)",
  anfahrt: "Anfahrt je Montage (€)",
  glasM2: "VSG-Glas Vordach (€/m²)",
  gitterrostStufe: "Gitterroststufe (€/Stk)",
  beschlagFluegel: "Torbeschlag je Flügel (€)",
  torantrieb: "Drehtorantrieb (€)",
};
export const HOURS_LABEL = { fertigungFix: "Werkstatt fix (Std.)", fertigungJe: "Werkstatt je Einheit (Std.)", montageFix: "Montage fix (Std.)", montageJe: "Montage je Einheit (Std.)" } as const;

export type Calc = {
  model: Model;
  /** fehlende Werte – dann kein Preis */
  missing: string[];
  steelKg: number;
  material: number;
  buy: number;
  beschichtung: number;
  fertigungStd: number;
  fertigung: number;
  montageStd: number;
  montage: number;
  zuschlag: number;
  net: number;
  /** Positionen fürs Angebot (Einzelpreise netto) */
  lines: { name: string; description: string; qty: number; unit: string; price: number }[];
};

const MONTAGE_OF: Record<Product, string> = { GELAENDER: "des Geländers", TREPPE: "der Treppe", VORDACH: "des Vordachs", TOR: "des Tores" };
const BUY_PRICE: Record<Buy["key"], keyof Kalk> = { glas: "glasM2", gitterrost: "gitterrostStufe", beschlag: "beschlagFluegel", antrieb: "torantrieb" };

export function calculate(product: Product, params: unknown, steel: PriceTable, kalk: Kalk): Calc {
  const p = parseParams(product, params);
  const model = buildModel(product, p);
  const missing = new Set<string>();
  const need = (v: number | null | undefined, label: string) => {
    if (v === null || v === undefined) {
      missing.add(label);
      return 0;
    }
    return v;
  };
  const verschnitt = 1 + need(kalk.verschnitt, KALK_LABEL.verschnitt) / 100;
  let material = 0;
  for (const part of model.parts) {
    const perKg = pricePerKg(steel, part.family, part.material);
    material += part.kg * verschnitt * need(perKg, `Stahlpreis ${part.material === "EDELSTAHL" ? "Edelstahl" : "Stahl"} (€/kg)`);
  }
  let buy = 0;
  for (const b of model.buy) buy += b.qty * need(kalk[BUY_PRICE[b.key]] as number | null, KALK_LABEL[BUY_PRICE[b.key] as keyof typeof KALK_LABEL]);
  const surf = (p as { oberflaeche: Surface }).oberflaeche;
  const stainless = (p as { werkstoff?: string }).werkstoff === "EDELSTAHL";
  const steelKg = model.parts.filter((x) => x.material === "STAHL").reduce((s, x) => s + x.kg, 0);
  const steelM2 = model.parts.filter((x) => x.material === "STAHL").reduce((s, x) => s + x.m2, 0);
  let beschichtung = 0;
  if (!stainless && (surf === "VERZINKT" || surf === "DUPLEX")) beschichtung += steelKg * need(steel.verzinken, "Zuschlag Verzinken (€/kg)");
  if (!stainless && (surf === "PULVER" || surf === "DUPLEX")) beschichtung += steelM2 * need(kalk.pulverM2, KALK_LABEL.pulverM2);
  const t = kalk.zeiten[product];
  const fertigungStd = r2(need(t.fertigungFix, `${PRODUCT_LABEL[product]}: ${HOURS_LABEL.fertigungFix}`) + need(t.fertigungJe, `${PRODUCT_LABEL[product]}: Werkstatt ${PRODUCT_UNIT[product].label} (Std.)`) * model.units);
  const fertigung = fertigungStd * need(kalk.stundensatzWerkstatt, KALK_LABEL.stundensatzWerkstatt);
  const withMontage = (p as { montage: boolean }).montage;
  const montageStd = withMontage ? r2(need(t.montageFix, `${PRODUCT_LABEL[product]}: ${HOURS_LABEL.montageFix}`) + need(t.montageJe, `${PRODUCT_LABEL[product]}: Montage ${PRODUCT_UNIT[product].label} (Std.)`) * model.units) : 0;
  const montage = withMontage ? montageStd * need(kalk.stundensatzMontage, KALK_LABEL.stundensatzMontage) + need(kalk.anfahrt, KALK_LABEL.anfahrt) : 0;
  const matZ = 1 + need(kalk.materialZuschlag, KALK_LABEL.materialZuschlag) / 100;
  const g = 1 + need(kalk.gewinnZuschlag, KALK_LABEL.gewinnZuschlag) / 100;
  const herstellung = r2(((material + buy) * matZ + beschichtung + fertigung) * g);
  const montageNet = r2(montage * g);
  const base = material + buy + beschichtung + fertigung + montage;
  const net = r2(herstellung + montageNet);
  const lines: Calc["lines"] = [{ name: `${model.title} – Lieferung und Fertigung`, description: model.specs.join("\n"), qty: 1, unit: "pauschal", price: herstellung }];
  if (withMontage) lines.push({ name: `Montage ${MONTAGE_OF[product]} vor Ort`, description: "inkl. Anfahrt, Befestigungsmaterial und Kleinteilen", qty: 1, unit: "pauschal", price: montageNet });
  return {
    model,
    missing: [...missing],
    steelKg: r2(steelKg),
    material: r2(material),
    buy: r2(buy),
    beschichtung: r2(beschichtung),
    fertigungStd,
    fertigung: r2(fertigung),
    montageStd,
    montage: r2(montage),
    zuschlag: r2(net - base),
    net,
    lines,
  };
}
