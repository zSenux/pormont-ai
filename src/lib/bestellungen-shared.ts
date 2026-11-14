// Bestellungen beim Lieferanten (für Client und Server)

export const BE_STATUSES = ["BESTELLT", "TEILGELIEFERT", "GELIEFERT", "STORNIERT"] as const;
export type BeStatus = (typeof BE_STATUSES)[number];
export const BE_LABEL: Record<BeStatus, string> = { BESTELLT: "Bestellt", TEILGELIEFERT: "Teilweise geliefert", GELIEFERT: "Geliefert", STORNIERT: "Storniert" };
export const BE_TONE: Record<BeStatus, string> = {
  BESTELLT: "border-sky-200 bg-sky-50 text-brand",
  TEILGELIEFERT: "border-amber-200 bg-amber-50 text-warn",
  GELIEFERT: "border-emerald-200 bg-emerald-50 text-ok",
  STORNIERT: "border-line bg-mist text-steel",
};

export type BeLine = { text: string; qty: number; unit: string | null; price: number | null; stockItemId: string | null; received: number };

export function readLines(raw: unknown): BeLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const x = (l ?? {}) as Record<string, unknown>;
    return { text: String(x.text ?? ""), qty: Number(x.qty) || 0, unit: x.unit ? String(x.unit) : null, price: x.price === null || x.price === undefined || x.price === "" ? null : Number(x.price), stockItemId: x.stockItemId ? String(x.stockItemId) : null, received: Number(x.received) || 0 };
  });
}

export const openQty = (l: BeLine) => Math.max(0, Math.round((l.qty - l.received) * 1000) / 1000);
export const fmtNum = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 3 });
