"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { klaicLicense } from "@/app/actions/klaic";

const STATUS: Record<string, string> = {
  frei: "Freigeschaltet",
  offen: "Noch nicht freigeschaltet",
  gesperrt: "Gesperrt",
  abgelaufen: "Befristung abgelaufen",
  entwicklung: "Entwicklung (ohne KLAIC_KEY frei)",
};

export function KlaicForm() {
  const [state, action, pending] = useActionState(klaicLicense, undefined);
  const s = state?.state;
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="key">Klaic-Schlüssel</label>
        <input id="key" name="key" type="password" autoComplete="off" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="bis">Gültig bis (optional)</label>
        <input id="bis" name="bis" type="date" className="input" defaultValue={s?.bis ?? ""} />
        <p className="mt-1 text-xs text-steel">Leer = unbefristet. Nach dem Datum sperrt Jarvis sich selbst.</p>
      </div>
      <div>
        <label className="label" htmlFor="hinweis">Hinweis für den Kunden (optional)</label>
        <textarea id="hinweis" name="hinweis" rows={2} maxLength={500} className="input" placeholder="z. B. Bitte offene Rechnung KM-2026-11-001 begleichen." defaultValue={s?.hinweis ?? ""} />
        <p className="mt-1 text-xs text-steel">Wird auf der Sperrseite angezeigt.</p>
      </div>
      {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-sm font-semibold text-ok">{state.ok}</p>}
      {s && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-ink">
          Status: <b>{STATUS[s.status]}</b>
          {s.bis ? ` · bis ${s.bis.split("-").reverse().join(".")}` : ""}
          {s.geaendert ? ` · geändert ${new Date(s.geaendert).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button name="aktion" value="freischalten" className="btn-primary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />} Freischalten
        </button>
        <button name="aktion" value="sperren" className="btn-danger" disabled={pending}>Sperren</button>
        <button name="aktion" value="status" className="btn-secondary" disabled={pending} formNoValidate>Status anzeigen</button>
      </div>
    </form>
  );
}
