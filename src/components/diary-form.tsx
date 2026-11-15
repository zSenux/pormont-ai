"use client";

import { useState } from "react";
import { Mic, Plus, Trash2 } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { saveDiaryEntry } from "@/app/actions/bautagebuch";
import { listen, speechSupported } from "@/components/jarvis/voice";

type Crew = { name: string; userId?: string | null; hours?: number | null };

// Bautagebuch-Eintrag eines Tages: Personal-Zeilen, Texte (auch per Diktat), Wetter optional von Hand
export function DiaryForm({ projectId, day, entry, users, suggestion }: { projectId: string; day: string; entry: { weather: string | null; crew: Crew[]; work: string | null; material: string | null; obstacles: string | null; visitors: string | null } | null; users: { id: string; name: string }[]; suggestion: Crew[] }) {
  const [crew, setCrew] = useState<Crew[]>(entry?.crew.length ? entry.crew : suggestion);
  const [texts, setTexts] = useState({ work: entry?.work ?? "", material: entry?.material ?? "", obstacles: entry?.obstacles ?? "", visitors: entry?.visitors ?? "" });
  const [rec, setRec] = useState<string | null>(null);
  const dictate = (k: keyof typeof texts) => {
    if (!speechSupported()) return alert("Diktat geht in Chrome, Edge und Safari.");
    setRec(k);
    listen({ onFinal: (t) => setTexts((x) => ({ ...x, [k]: x[k] ? `${x[k]} ${t}` : t })), onEnd: () => setRec(null), onError: () => setRec(null) });
  };
  const field = (k: keyof typeof texts, label: string, ph: string, rows = 3) => (
    <label className="block text-xs font-semibold text-steel sm:col-span-2">
      <span className="flex items-center justify-between">
        {label}
        <button type="button" onClick={() => dictate(k)} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${rec === k ? "bg-bad text-white" : "text-brand"}`} aria-label={`${label} diktieren`}>
          <Mic className="size-3.5" /> {rec === k ? "hört zu …" : "diktieren"}
        </button>
      </span>
      <textarea name={k} rows={rows} value={texts[k]} onChange={(e) => setTexts((x) => ({ ...x, [k]: e.target.value }))} placeholder={ph} className="input mt-1 resize-y font-normal" />
    </label>
  );
  return (
    <StateForm action={saveDiaryEntry} className="grid gap-3 sm:grid-cols-2" submit="Eintrag speichern">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="day" value={day} />
      <label className="block text-xs font-semibold text-steel sm:col-span-2">
        Wetter {entry?.weather ? "" : "(leer lassen = automatisch vom Wetterdienst)"}
        <input name="weather" defaultValue={entry?.weather ?? ""} placeholder="z. B. sonnig, 12–18 °C, trocken" className="input mt-1 font-normal" />
      </label>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs font-semibold text-steel">Personal auf der Baustelle</p>
        {crew.map((c, k) => (
          <div key={k} className="flex gap-2">
            <input type="hidden" name="crewUserId" value={c.userId ?? ""} />
            <input name="crewName" list="diary-users" value={c.name} onChange={(e) => setCrew((x) => x.map((y, n) => (n === k ? { ...y, name: e.target.value, userId: users.find((u) => u.name === e.target.value)?.id ?? null } : y)))} placeholder="Name (auch Subunternehmer)" className="input min-w-0 flex-1" aria-label="Name" />
            <input name="crewHours" inputMode="decimal" value={c.hours ?? ""} onChange={(e) => setCrew((x) => x.map((y, n) => (n === k ? { ...y, hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) } : y)))} placeholder="Std." className="input w-20" aria-label="Stunden" />
            <button type="button" onClick={() => setCrew((x) => x.filter((_, n) => n !== k))} className="btn-secondary px-2" aria-label="Zeile entfernen"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <datalist id="diary-users">{users.map((u) => <option key={u.id} value={u.name} />)}</datalist>
        <button type="button" onClick={() => setCrew((x) => [...x, { name: "", hours: null }])} className="btn-secondary text-xs"><Plus className="size-4" /> Person</button>
        {suggestion.length > 0 && !entry && <p className="text-xs text-steel">Vorschlag aus gebuchten Stunden und dem Montage-Team.</p>}
      </div>
      {field("work", "Ausgeführte Arbeiten", "z. B. Podest gesetzt, Treppenwangen ausgerichtet und verschraubt, 8 Stufen montiert", 4)}
      {field("material", "Material, Lieferungen, Geräte", "z. B. Gitterroste geliefert (Lieferschein 4711), Hubsteiger 12 m")}
      {field("obstacles", "Behinderungen & Besonderheiten", "z. B. Baustelle erst ab 9 Uhr frei, Estrich noch nass, Mehrleistung Abdeckung")}
      {field("visitors", "Besucher & Anordnungen", "z. B. Bauleiter Hr. Schmidt: Handlauf auf 1,00 m statt 0,90 m", 2)}
    </StateForm>
  );
}
