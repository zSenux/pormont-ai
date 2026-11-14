// Stahl-Materialkatalog: Normprofile (IPE, HEA, HEB, UPN, Winkel), Flach-/Rund-/Vierkantstahl, Rohre und Bleche
// mit Gewicht je Meter bzw. je m². Träger aus den Normtabellen (EN 10365), alles andere aus der Geometrie
// (Dichte Stahl 7,85 kg/dm³) – auch für Maße, die nicht in der Liste stehen (z. B. „Flachstahl 55x7“).
// Preise sind NICHT hinterlegt: Euro je kg trägt der Betrieb selbst ein (AppSetting „STAHLPREISE“, steel-prices.ts),
// Artikelpreise kommen aus den Lieferanten-Katalogen.
// Ohne server-only, damit der Rechner auf der Seite dieselben Werte nutzt.

export const STEEL_FAMILIES = ["IPE", "HEA", "HEB", "UPN", "L", "FL", "RD", "VK", "QR", "RR", "RO", "BL"] as const;
export type SteelFamily = (typeof STEEL_FAMILIES)[number];

export const FAMILY_LABEL: Record<SteelFamily, string> = {
  IPE: "IPE-Träger",
  HEA: "HEA-Träger (IPB leicht)",
  HEB: "HEB-Träger (IPB)",
  UPN: "U-Stahl (UPN)",
  L: "Winkelstahl gleichschenklig",
  FL: "Flachstahl",
  RD: "Rundstahl",
  VK: "Vierkantstahl",
  QR: "Quadratrohr",
  RR: "Rechteckrohr",
  RO: "Rundrohr",
  BL: "Blech",
};

/** Kategorie im Materiallager (src/lib/stock.ts) */
export const FAMILY_STOCK_CATEGORY: Record<SteelFamily, "PROFIL" | "ROHR" | "BLECH" | "FLACH_RUND"> = {
  IPE: "PROFIL", HEA: "PROFIL", HEB: "PROFIL", UPN: "PROFIL", L: "PROFIL",
  FL: "FLACH_RUND", RD: "FLACH_RUND", VK: "FLACH_RUND",
  QR: "ROHR", RR: "ROHR", RO: "ROHR",
  BL: "BLECH",
};

export const MATERIALS = ["STAHL", "EDELSTAHL", "ALU"] as const;
export type SteelMaterial = (typeof MATERIALS)[number];
export const MATERIAL_LABEL: Record<SteelMaterial, string> = { STAHL: "Stahl (S235/S355)", EDELSTAHL: "Edelstahl (1.4301/V2A)", ALU: "Aluminium" };
/** Dichte in kg/dm³ */
export const DENSITY: Record<SteelMaterial, number> = { STAHL: 7.85, EDELSTAHL: 7.9, ALU: 2.7 };
/** Träger und Winkel gibt es nur in Stahl */
export const STEEL_ONLY: ReadonlySet<SteelFamily> = new Set(["IPE", "HEA", "HEB", "UPN", "L"]);

export type SteelProfile = {
  family: SteelFamily;
  /** Anzeigename, z. B. „HEB 200“, „Flachstahl 50x8“ */
  name: string;
  /** Kurzschlüssel ohne Leerzeichen, z. B. „heb200“, „fl50x8“ */
  key: string;
  /** Maße in mm (Bedeutung je Familie, siehe dimsText) */
  dims: number[];
  /** Gewicht Stahl: kg je m (Bleche: kg je m²) */
  kg: number;
  /** "m" oder "m²" */
  per: "m" | "m²";
  /** true = Tabellenwert der Norm, false = aus Geometrie berechnet */
  table: boolean;
};

const fmt = (n: number) => String(n).replace(".", ",");
const r2 = (n: number) => Math.round(n * 100) / 100;
const kgOf = (areaMm2: number) => r2(areaMm2 * 7.85e-3);

// ---------- Träger: [Nenngröße, h, b, tw, tf, r, kg/m] nach EN 10365 ----------
type Beam = [number, number, number, number, number, number, number];
const IPE: Beam[] = [
  [80, 80, 46, 3.8, 5.2, 5, 6.0], [100, 100, 55, 4.1, 5.7, 7, 8.1], [120, 120, 64, 4.4, 6.3, 7, 10.4], [140, 140, 73, 4.7, 6.9, 7, 12.9],
  [160, 160, 82, 5.0, 7.4, 9, 15.8], [180, 180, 91, 5.3, 8.0, 9, 18.8], [200, 200, 100, 5.6, 8.5, 12, 22.4], [220, 220, 110, 5.9, 9.2, 12, 26.2],
  [240, 240, 120, 6.2, 9.8, 15, 30.7], [270, 270, 135, 6.6, 10.2, 15, 36.1], [300, 300, 150, 7.1, 10.7, 15, 42.2], [330, 330, 160, 7.5, 11.5, 18, 49.1],
  [360, 360, 170, 8.0, 12.7, 18, 57.1], [400, 400, 180, 8.6, 13.5, 21, 66.3], [450, 450, 190, 9.4, 14.6, 21, 77.6], [500, 500, 200, 10.2, 16.0, 21, 90.7],
  [550, 550, 210, 11.1, 17.2, 24, 106], [600, 600, 220, 12.0, 19.0, 24, 122],
];
const HEA: Beam[] = [
  [100, 96, 100, 5, 8, 12, 16.7], [120, 114, 120, 5, 8, 12, 19.9], [140, 133, 140, 5.5, 8.5, 12, 24.7], [160, 152, 160, 6, 9, 15, 30.4],
  [180, 171, 180, 6, 9.5, 15, 35.5], [200, 190, 200, 6.5, 10, 18, 42.3], [220, 210, 220, 7, 11, 18, 50.5], [240, 230, 240, 7.5, 12, 21, 60.3],
  [260, 250, 260, 7.5, 12.5, 24, 68.2], [280, 270, 280, 8, 13, 24, 76.4], [300, 290, 300, 8.5, 14, 27, 88.3], [320, 310, 300, 9, 15.5, 27, 97.6],
  [340, 330, 300, 9.5, 16.5, 27, 105], [360, 350, 300, 10, 17.5, 27, 112], [400, 390, 300, 11, 19, 27, 125], [450, 440, 300, 11.5, 21, 27, 140],
  [500, 490, 300, 12, 23, 27, 155], [550, 540, 300, 12.5, 24, 27, 166], [600, 590, 300, 13, 25, 27, 178],
];
const HEB: Beam[] = [
  [100, 100, 100, 6, 10, 12, 20.4], [120, 120, 120, 6.5, 11, 12, 26.7], [140, 140, 140, 7, 12, 12, 33.7], [160, 160, 160, 8, 13, 15, 42.6],
  [180, 180, 180, 8.5, 14, 15, 51.2], [200, 200, 200, 9, 15, 18, 61.3], [220, 220, 220, 9.5, 16, 18, 71.5], [240, 240, 240, 10, 17, 21, 83.2],
  [260, 260, 260, 10, 17.5, 24, 93.0], [280, 280, 280, 10.5, 18, 24, 103], [300, 300, 300, 11, 19, 27, 117], [320, 320, 300, 11.5, 20.5, 27, 127],
  [340, 340, 300, 12, 21.5, 27, 134], [360, 360, 300, 12.5, 22.5, 27, 142], [400, 400, 300, 13.5, 24, 27, 155], [450, 450, 300, 14, 26, 27, 171],
  [500, 500, 300, 14.5, 28, 27, 187], [550, 550, 300, 15, 29, 27, 199], [600, 600, 300, 15.5, 30, 27, 212],
];
// UPN (DIN 1026-1): [h, b, tw, t (mittlere Flanschdicke), kg/m]
const UPN: [number, number, number, number, number][] = [
  [50, 38, 5, 7, 5.59], [65, 42, 5.5, 7.5, 7.09], [80, 45, 6, 8, 8.64], [100, 50, 6, 8.5, 10.6], [120, 55, 7, 9, 13.4],
  [140, 60, 7, 10, 16.0], [160, 65, 7.5, 10.5, 18.8], [180, 70, 8, 11, 22.0], [200, 75, 8.5, 11.5, 25.3], [220, 80, 9, 12.5, 29.4],
  [240, 85, 9.5, 13, 33.2], [260, 90, 10, 14, 37.9], [280, 95, 10, 15, 41.8], [300, 100, 10, 16, 46.2],
];

/** Querschnitt eines I-Trägers aus h, b, tw, tf, r (mm²) – zur Kontrolle der Tabellenwerte */
export const beamArea = (h: number, b: number, tw: number, tf: number, r: number) => 2 * b * tf + (h - 2 * tf) * tw + (4 - Math.PI) * r * r;

// ---------- Geometrie (mm → kg/m bzw. kg/m²) ----------
export const geo = {
  /** Winkel gleichschenklig a × t (ohne Ausrundungen, ca.) */
  L: (a: number, t: number) => kgOf(t * (2 * a - t)),
  FL: (b: number, t: number) => kgOf(b * t),
  RD: (d: number) => kgOf((Math.PI * d * d) / 4),
  VK: (a: number) => kgOf(a * a),
  /** Hohlprofil h × b × t, kaltgeformt (EN 10219: Außenradius 2t, Innenradius t) */
  RR: (h: number, b: number, t: number) => kgOf(2 * t * (h + b - 2 * t) - (4 - Math.PI) * 3 * t * t),
  RO: (d: number, t: number) => kgOf(Math.PI * (d - t) * t),
  /** Blech t mm → kg/m² */
  BL: (t: number) => r2(t * 7.85),
};

function make(family: SteelFamily, name: string, dims: number[], kg: number, table: boolean): SteelProfile {
  return { family, name, key: normKey(name), dims, kg, per: family === "BL" ? "m²" : "m", table };
}

const x = (...n: number[]) => n.map(fmt).join("x");

function build(): SteelProfile[] {
  const out: SteelProfile[] = [];
  for (const [fam, list] of [["IPE", IPE], ["HEA", HEA], ["HEB", HEB]] as const) for (const [n, h, b, tw, tf, r, kg] of list) out.push(make(fam, `${fam} ${n}`, [h, b, tw, tf, r], kg, true));
  for (const [h, b, tw, t, kg] of UPN) out.push(make("UPN", `UPN ${h}`, [h, b, tw, t], kg, true));
  const L: [number, number][] = [[20, 3], [25, 3], [25, 4], [30, 3], [30, 4], [35, 4], [40, 4], [40, 5], [45, 5], [50, 5], [50, 6], [60, 6], [60, 8], [70, 7], [80, 8], [90, 9], [100, 10], [120, 12], [150, 15]];
  for (const [a, t] of L) out.push(make("L", `Winkel ${x(a, a, t)}`, [a, t], geo.L(a, t), false));
  const FLW = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120, 150, 200];
  const FLT = [3, 4, 5, 6, 8, 10, 12, 15, 20];
  for (const b of FLW) for (const t of FLT) if (t < b && t <= b / 2) out.push(make("FL", `Flachstahl ${x(b, t)}`, [b, t], geo.FL(b, t), false));
  for (const d of [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100]) out.push(make("RD", `Rundstahl ${d}`, [d], geo.RD(d), false));
  for (const a of [8, 10, 12, 14, 16, 20, 25, 30, 40, 50]) out.push(make("VK", `Vierkantstahl ${a}`, [a], geo.VK(a), false));
  const QR: [number, number][] = [[20, 2], [25, 2], [30, 2], [30, 3], [35, 2], [40, 2], [40, 3], [40, 4], [50, 2], [50, 3], [50, 4], [60, 3], [60, 4], [70, 3], [70, 4], [80, 3], [80, 4], [80, 5], [100, 4], [100, 5], [100, 6], [120, 5], [120, 6], [140, 5], [140, 6], [150, 6], [160, 6], [200, 8]];
  for (const [a, t] of QR) out.push(make("QR", `Quadratrohr ${x(a, a, t)}`, [a, a, t], geo.RR(a, a, t), false));
  const RR: [number, number, number][] = [[30, 20, 2], [40, 20, 2], [40, 30, 2], [50, 30, 2], [50, 30, 3], [60, 30, 3], [60, 40, 2], [60, 40, 3], [60, 40, 4], [80, 40, 3], [80, 40, 4], [80, 60, 3], [80, 60, 4], [100, 40, 4], [100, 50, 4], [100, 60, 4], [100, 60, 5], [120, 60, 4], [120, 60, 5], [120, 80, 5], [140, 80, 5], [160, 80, 5], [160, 80, 6], [200, 100, 6]];
  for (const [h, b, t] of RR) out.push(make("RR", `Rechteckrohr ${x(h, b, t)}`, [h, b, t], geo.RR(h, b, t), false));
  const RO: [number, number][] = [[21.3, 2], [26.9, 2.3], [33.7, 2.6], [42.4, 2.6], [42.4, 3.2], [48.3, 2.6], [48.3, 3.2], [60.3, 2.9], [60.3, 4], [76.1, 2.9], [76.1, 4], [88.9, 3.2], [88.9, 4], [101.6, 4], [114.3, 4], [139.7, 4], [168.3, 5]];
  for (const [d, t] of RO) out.push(make("RO", `Rundrohr ${x(d, t)}`, [d, t], geo.RO(d, t), false));
  for (const t of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]) out.push(make("BL", `Blech ${fmt(t)} mm`, [t], geo.BL(t), false));
  return out;
}

export const STEEL_PROFILES: readonly SteelProfile[] = build();

/** „HEB 200“, „Flachstahl 50 x 8 mm“, „Rohr 48,3x2,6“ → „heb200“, „fl50x8“, „ro48.3x2.6“ */
export function normKey(raw: string) {
  let s = raw.toLowerCase().replace(/[×*]/g, "x").replace(/(\d),(\d)/g, "$1.$2").replace(/mm\b|s235\w*|s355\w*|\bstahl\b/g, " ");
  const words: [RegExp, string][] = [
    [/\b(flachstahl|flacheisen|flach|fl\.?)\s*/g, "fl"],
    [/\b(rundstahl|rundeisen|rd\.?)\s*/g, "rd"],
    [/\b(vierkantstahl|vierkant|vk\.?)\s*(?!rohr)/g, "vk"],
    [/\b(quadratrohr|vierkantrohr|qr\.?)\s*/g, "qr"],
    [/\b(rechteckrohr|rr\.?)\s*/g, "rr"],
    [/\b(rundrohr|stahlrohr|rohr|ro\.?)\s*/g, "ro"],
    [/\b(winkelstahl|winkel|l-?profil|l)\s*/g, "l"],
    [/\b(blech|bl\.?|tafel)\s*/g, "bl"],
    [/\b(u-?stahl|u-?profil|upn|u)\s*/g, "upn"],
    [/\bipe\s*/g, "ipe"], [/\bhea\s*|\bipbl\s*/g, "hea"], [/\bheb\s*|\bipb\s*/g, "heb"],
  ];
  for (const [re, k] of words) s = s.replace(re, `${k} `);
  return s.replace(/\s+/g, "").replace(/\.0(?=\D|$)/g, "");
}

/** Eintrag zum Namen finden – auch Maße, die nicht in der Liste stehen (aus der Geometrie) */
export function findProfile(raw: string): SteelProfile | null {
  let key = normKey(raw);
  // Gleichschenklig kurz geschrieben: „Winkel 50x5“ = 50x50x5, „Quadratrohr 40x3“ = 40x40x3
  const short = /^(l|qr)(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(key);
  if (short) key = `${short[1]}${short[2]}x${short[2]}x${short[3]}`;
  const hit = STEEL_PROFILES.find((p) => p.key === key);
  if (hit) return hit;
  const m = /^([a-z]+)([\d.x]+)$/.exec(key);
  if (!m) return null;
  const n = m[2].split("x").map(Number);
  if (n.some((v) => !Number.isFinite(v) || v <= 0 || v > 2000)) return null;
  const [a, b, c] = n;
  switch (m[1]) {
    case "fl": return n.length === 2 && b < a ? make("FL", `Flachstahl ${x(a, b)}`, [a, b], geo.FL(a, b), false) : null;
    case "rd": return n.length === 1 ? make("RD", `Rundstahl ${fmt(a)}`, [a], geo.RD(a), false) : null;
    case "vk": return n.length === 1 ? make("VK", `Vierkantstahl ${fmt(a)}`, [a], geo.VK(a), false) : null;
    case "l": return n.length === 3 && a === b && c < a / 2 ? make("L", `Winkel ${x(a, a, c)}`, [a, c], geo.L(a, c), false) : null;
    case "qr": return n.length === 3 && a === b && c < a / 2 ? make("QR", `Quadratrohr ${x(a, a, c)}`, [a, a, c], geo.RR(a, a, c), false) : null;
    case "rr": return n.length === 3 && c < Math.min(a, b) / 2 ? make("RR", `Rechteckrohr ${x(a, b, c)}`, [a, b, c], geo.RR(a, b, c), false) : null;
    case "ro": return n.length === 2 && b < a / 2 ? make("RO", `Rundrohr ${x(a, b)}`, [a, b], geo.RO(a, b), false) : null;
    case "bl": return n.length === 1 && a <= 200 ? make("BL", `Blech ${fmt(a)} mm`, [a], geo.BL(a), false) : null;
    default: return null;
  }
}

/** Liste durchsuchen (alle Wörter müssen passen) */
export function searchProfiles(q: string, family?: SteelFamily | null, take = 400) {
  const exact = q.trim() ? findProfile(q) : null;
  const words = q.toLowerCase().replace(/[×*]/g, "x").replace(/(\d),(\d)/g, "$1.$2").split(/\s+/).filter(Boolean);
  const list = STEEL_PROFILES.filter((p) => (!family || p.family === family) && words.every((w) => `${p.name.toLowerCase().replace(/(\d),(\d)/g, "$1.$2")} ${p.key} ${FAMILY_LABEL[p.family].toLowerCase()}`.includes(w)));
  if (exact && (!family || exact.family === family) && !list.some((p) => p.key === exact.key)) list.unshift(exact);
  return list.slice(0, take);
}

/** Maße lesbar: „h 200 · b 200 · s 9 · t 15 mm“ */
export function dimsText(p: SteelProfile) {
  const d = p.dims.map(fmt);
  switch (p.family) {
    case "IPE": case "HEA": case "HEB": return `h ${d[0]} · b ${d[1]} · s ${d[2]} · t ${d[3]} mm`;
    case "UPN": return `h ${d[0]} · b ${d[1]} · s ${d[2]} · t ${d[3]} mm`;
    case "L": return `${d[0]} × ${d[0]} × ${d[1]} mm`;
    case "FL": return `${d[0]} × ${d[1]} mm`;
    case "RD": return `Ø ${d[0]} mm`;
    case "VK": return `${d[0]} × ${d[0]} mm`;
    case "QR": case "RR": return `${d[0]} × ${d[1]} × ${d[2]} mm`;
    case "RO": return `Ø ${d[0]} × ${d[1]} mm`;
    case "BL": return `${d[0]} mm dick`;
  }
}

/** Gewicht je m bzw. m² im gewählten Werkstoff */
export function unitWeight(p: SteelProfile, material: SteelMaterial = "STAHL") {
  const m = STEEL_ONLY.has(p.family) ? "STAHL" : material;
  return r2((p.kg * DENSITY[m]) / DENSITY.STAHL);
}

export type SteelCalc = {
  profile: SteelProfile;
  material: SteelMaterial;
  /** Gewicht je m bzw. m² */
  unitKg: number;
  /** Gesamtmenge in m bzw. m² */
  amount: number;
  totalKg: number;
};

/**
 * Gewicht berechnen. Stäbe: stueck × laenge (m). Bleche: stueck × laenge × breite (m).
 */
export function calcWeight(o: { profile: SteelProfile; material?: SteelMaterial; laengeM: number; stueck?: number; breiteM?: number }): SteelCalc {
  const material = STEEL_ONLY.has(o.profile.family) ? "STAHL" : (o.material ?? "STAHL");
  const stueck = o.stueck ?? 1;
  const amount = o.profile.family === "BL" ? stueck * o.laengeM * (o.breiteM ?? 1) : stueck * o.laengeM;
  const unitKg = unitWeight(o.profile, material);
  return { profile: o.profile, material, unitKg, amount: Math.round(amount * 1000) / 1000, totalKg: r2(unitKg * amount) };
}

/** Eigene Einkaufspreise (€ je kg netto), siehe steel-prices.ts */
export type PriceTable = { STAHL?: number | null; EDELSTAHL?: number | null; ALU?: number | null; verzinken?: number | null; familien: Partial<Record<SteelFamily, number>> };

/** € je kg für ein Profil (Profilart vor Werkstoff), null = nicht hinterlegt */
export function pricePerKg(p: PriceTable, family: SteelFamily, material: SteelMaterial): number | null {
  const m = STEEL_ONLY.has(family) ? "STAHL" : material;
  const fam = p.familien[family];
  if (m === "STAHL" && fam !== undefined) return fam;
  return p[m] ?? null;
}

/** Materialpreis netto für eine Berechnung, null = kein Preis hinterlegt */
export function priceOf(p: PriceTable, c: SteelCalc, verzinkt = false) {
  const kg = pricePerKg(p, c.profile.family, c.material);
  if (kg === null) return null;
  const zuschlag = verzinkt ? (p.verzinken ?? null) : 0;
  return { perKg: kg, zuschlag, total: Math.round(c.totalKg * (kg + (zuschlag ?? 0)) * 100) / 100 };
}

export const kgText = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} kg`;
