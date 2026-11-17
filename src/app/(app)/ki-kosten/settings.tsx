"use client";

import { StateForm } from "@/components/state-form";
import { saveKiConfigAction } from "@/app/actions/ki-kosten";
import type { KiConfig } from "@/lib/ki-kosten";

/** Kurs und Monatsbudget (Admin) */
export function KiSettings({ cfg }: { cfg: KiConfig }) {
  return (
    <StateForm action={saveKiConfigAction} submit="Speichern">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-steel">
          Kurs: 1 US-Dollar = … Euro
          <input name="usdEur" inputMode="decimal" defaultValue={cfg.usdEur.toLocaleString("de-DE", { maximumFractionDigits: 4 })} className="input mt-0.5" />
        </label>
        <label className="text-xs text-steel">
          Monatsbudget in Euro (leer = keins)
          <input name="budgetEur" inputMode="decimal" defaultValue={cfg.budgetEur ? cfg.budgetEur.toLocaleString("de-DE") : ""} placeholder="z. B. 150" className="input mt-0.5" />
        </label>
      </div>
      <p className="text-xs text-steel">Bei 80 % und 100 % des Budgets bekommen die Admins einmal im Monat eine Push-Nachricht. Jarvis wird dabei nicht gesperrt.</p>
    </StateForm>
  );
}
