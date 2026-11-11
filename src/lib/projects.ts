export const STATUS_LABEL = { PLANUNG: "In Planung", LAEUFT: "Läuft", PAUSIERT: "Pausiert", FERTIG: "Fertig" } as const;
export const STATUS_TONE = { PLANUNG: "bg-amber-50 text-warn border-amber-200", LAEUFT: "bg-brand-soft text-brand border-brand/20", PAUSIERT: "bg-mist text-steel border-line", FERTIG: "bg-emerald-50 text-ok border-emerald-200" } as const;
export type ProjectStatusKey = keyof typeof STATUS_LABEL;
