// Auftragsstatus – ohne Server-Abhängigkeiten
export const ORDER_STATUS_LABEL = { NEU: "Neu", IN_ARBEIT: "In Arbeit", PAUSIERT: "Pausiert", ABGESCHLOSSEN: "Abgeschlossen", STORNIERT: "Storniert" } as const;
export type OrderStatus = keyof typeof ORDER_STATUS_LABEL;
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as [OrderStatus, ...OrderStatus[]];
export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  NEU: "bg-amber-50 text-warn border-amber-200",
  IN_ARBEIT: "bg-brand-soft text-brand border-brand/20",
  PAUSIERT: "bg-mist text-steel border-line",
  ABGESCHLOSSEN: "bg-emerald-50 text-ok border-emerald-200",
  STORNIERT: "bg-red-50 text-bad border-red-200",
};
