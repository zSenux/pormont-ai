"use client";

import { StateForm } from "@/components/state-form";
import { saveRatesAction } from "@/app/actions/spesen";
import { euro, type MealDay, type SpesenRates } from "@/lib/spesen";

const eur = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 });

/** Spesensätze der Firma (Admin) – daneben jeweils der steuerfreie Satz */
export function RatesForm({ rates, legal, labels }: { rates: SpesenRates; legal: SpesenRates; labels: Record<MealDay, string> }) {
  const field = (name: string, label: string, value: number, free: number, unit = "€") => (
    <label className="text-xs text-steel">
      {label}
      <span className="mt-0.5 flex items-center gap-2"><input name={name} inputMode="decimal" defaultValue={eur(value)} className="input w-28" /> <span className="whitespace-nowrap">{unit} · steuerfrei {euro(free)}</span></span>
    </label>
  );
  return (
    <StateForm action={saveRatesAction} submit="Sätze speichern">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["TAG8", "REISE", "TAG24"] as MealDay[]).map((k) => field(k, `Verpflegung: ${labels[k]}`, rates.meal[k], legal.meal[k]))}
        {field("km", "Kilometergeld eigenes Auto", rates.km, legal.km, "€/km")}
        {field("night", "Übernachtung ohne Beleg", rates.night, legal.night)}
      </div>
    </StateForm>
  );
}
