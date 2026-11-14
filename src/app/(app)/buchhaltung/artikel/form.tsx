"use client";

import { Plus } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { saveArticleAction } from "@/app/actions/buchhaltung";

type A = { id: string; number: string | null; name: string; description: string | null; unit: string; priceNet: number; taxRate: number; kind: string };

export function ArticleForm({ a }: { a?: A }) {
  return (
    <StateForm action={saveArticleAction.bind(null, a?.id ?? null)} submit={a ? "Speichern" : <><Plus className="size-4" /> Anlegen</>} reset={!a}>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <input name="number" defaultValue={a?.number ?? ""} placeholder="Art.-Nr." className="input" aria-label="Artikelnummer" />
        <input name="name" required defaultValue={a?.name ?? ""} placeholder="Bezeichnung, z. B. Montagestunde Geselle" className="input" aria-label="Bezeichnung" />
      </div>
      <textarea name="description" defaultValue={a?.description ?? ""} rows={2} placeholder="Beschreibung (erscheint auf dem Beleg)" className="input resize-y" aria-label="Beschreibung" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input name="priceNet" required inputMode="decimal" defaultValue={a ? String(a.priceNet).replace(".", ",") : ""} placeholder="Preis netto €" className="input" aria-label="Preis netto" />
        <input name="unit" defaultValue={a?.unit ?? "Stk"} placeholder="Einheit" className="input" aria-label="Einheit" />
        <select name="taxRate" defaultValue={a?.taxRate ?? 19} className="input" aria-label="USt."><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></select>
        <select name="kind" defaultValue={a?.kind ?? "LEISTUNG"} className="input" aria-label="Art"><option value="LEISTUNG">Leistung</option><option value="MATERIAL">Material</option></select>
      </div>
    </StateForm>
  );
}
