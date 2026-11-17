"use client";

import { StateForm } from "@/components/state-form";
import { saveKiModelAction } from "@/app/actions/ki-kosten";
import { CHEAPEST_MODEL, KI_FEATURES, KI_MODELS, modelInfo, type KiModelConfig } from "@/lib/ki-modell-shared";

const price = (m: (typeof KI_MODELS)[number]) =>
  `${m.inUsd.toLocaleString("de-DE")} $ / ${m.outUsd.toLocaleString("de-DE")} $ je 1 Mio. Tokens`;

/** Welches Claude-Modell Jarvis nutzt – Standard = günstigstes (Haiku 5.5), je Funktion änderbar (Admin) */
export function KiModelSettings({ cfg }: { cfg: KiModelConfig }) {
  return (
    <StateForm action={saveKiModelAction} submit="Speichern">
      <fieldset>
        <legend className="text-xs text-steel">Standard für alle Funktionen</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {KI_MODELS.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="standard" value={m.id} defaultChecked={cfg.standard === m.id} className="mt-1 accent-brand" />
              <span className="text-sm">
                <span className="font-semibold">{m.label}</span>
                {m.id === CHEAPEST_MODEL && <span className="ml-1.5 rounded bg-ok/15 px-1.5 py-0.5 text-[11px] font-medium text-ok">Sparmodus</span>}
                <span className="block text-xs text-steel">{m.hint} · {price(m)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="text-xs text-steel">Je Funktion (leer lassen = Standard)</p>
        <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line">
          {KI_FEATURES.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 text-sm">
                {f.label}
                {f.hint && <span className="block text-xs text-steel">{f.hint}</span>}
              </span>
              <select name={`f_${f.key}`} defaultValue={cfg.features[f.key] ?? ""} className="input !w-auto min-w-44" aria-label={`Modell für ${f.label}`}>
                <option value="">wie Standard ({modelInfo(cfg.standard)?.label})</option>
                {KI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-steel">
        Haiku 5.5 kostet rund ein Vierzigstel von Opus 5.5 und reicht für Chat, Belege, Diktate und Briefe. Wenn eine Funktion öfter danebenliegt, hier nur für diese ein stärkeres Modell wählen.
      </p>
    </StateForm>
  );
}
