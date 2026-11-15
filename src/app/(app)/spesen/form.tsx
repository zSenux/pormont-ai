"use client";

import { useState } from "react";
import { Camera, Check, Loader2 } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { shrink } from "@/components/upload";
import { addExpense } from "@/app/actions/spesen";
import { KINDS, KIND_LABEL, MEAL_LABEL, MEAL_RATES, TAX_LABEL, euro, kmAmount, mealAmountAt, taxSplit, type ExpenseKind, type MealDay, type SpesenRates } from "@/lib/spesen";

type Receipt = { brutto: number | null; datum: string | null; lieferant: string | null; lesbar: boolean } | null;

export function ExpenseForm({ today, projects, rates }: { today: string; projects: { id: string; name: string }[]; rates: SpesenRates }) {
  const [kind, setKind] = useState<ExpenseKind>("VERPFLEGUNG");
  const [mealDay, setMealDay] = useState<MealDay>("TAG8");
  const [meals, setMeals] = useState({ breakfast: false, lunch: false, dinner: false });
  const [km, setKm] = useState("");
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flat, setFlat] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.set("kind", "spesen");
      form.append("files", await shrink(f));
      const res = await fetch("/api/dateien", { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string; files?: { id: string; name: string; receipt: Receipt }[] };
      const up = j.files?.[0];
      if (!res.ok || !up) throw new Error(j.error ?? "Hochladen fehlgeschlagen.");
      setFile({ id: up.id, name: up.name });
      const r = up.receipt;
      if (r?.lesbar) {
        if (r.brutto) setAmount(r.brutto.toLocaleString("de-DE", { minimumFractionDigits: 2 }));
        if (r.datum && r.datum <= today) setDay(r.datum);
        if (r.lieferant && !desc) setDesc(r.lieferant);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preview = kind === "VERPFLEGUNG" ? mealAmountAt(rates, mealDay, meals) : kind === "FAHRT" && +km > 0 ? kmAmount(+km, rates.km) : kind === "UEBERNACHTUNG" && flat ? rates.night : null;
  const nightFlat = kind === "UEBERNACHTUNG" && flat;
  const needsReceipt = (kind === "UEBERNACHTUNG" && !flat) || kind === "AUSLAGE";
  const split = preview !== null ? taxSplit({ kind, amountCents: preview, mealDay, ...meals, km: +km || 0, fileId: nightFlat ? null : (file?.id ?? null) }) : null;

  return (
    <StateForm action={addExpense} submit="Einreichen" onOk={() => { setFile(null); setAmount(""); setDesc(""); setKm(""); setMeals({ breakfast: false, lunch: false, dinner: false }); }}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`chip justify-center px-2 py-2 text-xs ${kind === k ? "border-brand bg-brand text-white" : "bg-white text-steel"}`}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      {file && <input type="hidden" name="fileId" value={file.id} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">Tag<input type="date" name="day" required max={today} value={day} onChange={(e) => setDay(e.target.value)} className="input mt-1 w-full" /></label>
        <label className="text-xs text-steel">Projekt / Baustelle<select name="projectId" className="input mt-1 w-full" defaultValue=""><option value="">–</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>

      {kind === "VERPFLEGUNG" && (
        <div className="space-y-2">
          <select name="mealDay" value={mealDay} onChange={(e) => setMealDay(e.target.value as MealDay)} className="input w-full" aria-label="Abwesenheit">
            {(Object.keys(MEAL_RATES) as MealDay[]).map((k) => <option key={k} value={k}>{MEAL_LABEL[k]} – {euro(rates.meal[k])}{rates.meal[k] > MEAL_RATES[k] ? ` (davon ${euro(MEAL_RATES[k])} steuerfrei)` : ""}</option>)}
          </select>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1 text-xs text-steel">Mahlzeiten bezahlt bekommen (Kunde/Firma)?</legend>
            {([["breakfast", "Frühstück"], ["lunch", "Mittag"], ["dinner", "Abendessen"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name={k} checked={meals[k]} onChange={(e) => setMeals({ ...meals, [k]: e.target.checked })} className="size-4" /> {l}</label>
            ))}
          </fieldset>
        </div>
      )}
      {kind === "FAHRT" && (
        <label className="block text-xs text-steel">Gefahrene Kilometer (Hin + Rück) mit eigenem Auto · {euro(rates.km)} je km<input name="km" inputMode="numeric" required value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} className="input mt-1 w-full" /></label>
      )}
      {kind === "UEBERNACHTUNG" && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pauschal" checked={flat} onChange={(e) => setFlat(e.target.checked)} className="size-4" /> Ohne Beleg – Übernachtungspauschale {euro(rates.night)}</label>
      )}
      {needsReceipt && (
        <div className="space-y-2">
          <label className={`btn-secondary w-fit cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : file ? <Check className="size-4 text-ok" /> : <Camera className="size-4" />}
            {busy ? "Jarvis liest den Beleg …" : file ? `Beleg: ${file.name}` : "Beleg fotografieren"}
            <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
          {err && <p className="text-sm text-bad">{err}</p>}
          <label className="block text-xs text-steel">Betrag brutto (€)<input name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="z. B. 89,00" className="input mt-1 w-full" /></label>
        </div>
      )}
      <input name="description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={kind === "FAHRT" ? "Strecke, z. B. Mannheim – Baustelle Heidelberg und zurück" : kind === "VERPFLEGUNG" ? "Anlass, z. B. Montage BASF Ludwigshafen" : "Wofür? z. B. Hotel Speyer, Schrauben Baumarkt"} className="input w-full" aria-label="Beschreibung" />
      {preview !== null && <p className="text-sm">Betrag: <b>{euro(preview)}</b>{kind === "VERPFLEGUNG" && preview < rates.meal[mealDay] && <span className="text-steel"> (gekürzt wegen gestellter Mahlzeiten)</span>}</p>}
      {split && (split.flat25 > 0 || split.taxable > 0) && (
        <p className="rounded-xl bg-mist px-3 py-2 text-xs text-steel">
          Davon {euro(split.free)} {TAX_LABEL.free}
          {split.flat25 > 0 && <> · <b className="text-ink">{euro(split.flat25)}</b> {TAX_LABEL.flat25}</>}
          {split.taxable > 0 && <> · <b className="text-ink">{euro(split.taxable)}</b> {TAX_LABEL.taxable}</>}
        </p>
      )}
    </StateForm>
  );
}
