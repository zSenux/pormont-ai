"use client";

import { useState } from "react";
import { StateForm } from "@/components/state-form";
import { addWorkTime } from "@/app/actions/zeiten";

const KINDS = [["ARBEIT", "Arbeit"], ["FAHRT", "Fahrtzeit"], ["URLAUB", "Urlaub"], ["KRANK", "Krank"], ["FEIERTAG", "Feiertag"]] as const;

export function AddTime({ today, projects, users }: { today: string; projects: { id: string; name: string }[]; users: { id: string; name: string }[] | null }) {
  const [mode, setMode] = useState<"vonbis" | "stunden">("vonbis");
  return (
    <StateForm action={addWorkTime} submit="Eintragen" reset>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">Tag<input type="date" name="day" required max={today} defaultValue={today} className="input mt-1 w-full" /></label>
        <label className="text-xs text-steel">Art<select name="kind" className="input mt-1 w-full">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <div className="flex gap-1.5 text-xs">
        <button type="button" onClick={() => setMode("vonbis")} className={`chip px-3 py-1 ${mode === "vonbis" ? "border-brand bg-brand text-white" : "bg-white text-steel"}`}>Von – Bis</button>
        <button type="button" onClick={() => setMode("stunden")} className={`chip px-3 py-1 ${mode === "stunden" ? "border-brand bg-brand text-white" : "bg-white text-steel"}`}>Nur Stunden</button>
      </div>
      {mode === "vonbis" ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-steel">Von<input type="time" name="from" required defaultValue="07:00" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Bis<input type="time" name="to" required defaultValue="16:00" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Pause min<input name="pause" inputMode="numeric" defaultValue="45" className="input mt-1 w-full" /></label>
        </div>
      ) : (
        <label className="block text-xs text-steel">Stunden<input name="hours" required placeholder="z. B. 8 oder 7:30" className="input mt-1 w-full" /></label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="projectId" className="input" aria-label="Projekt" defaultValue="">
          <option value="">Ohne Projekt</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {users ? (
          <select name="userId" className="input" aria-label="Mitarbeiter" defaultValue="">
            <option value="">Für mich</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        ) : <span />}
        <input name="note" placeholder="Notiz (optional)" className="input sm:col-span-2" aria-label="Notiz" />
      </div>
    </StateForm>
  );
}
