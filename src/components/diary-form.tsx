"use client";

import { useState } from "react";
import { Mic, Plus, Trash2 } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { saveDiaryEntry } from "@/app/actions/bautagebuch";
import { listen, speechSupported } from "@/components/jarvis/voice";
import { changeHours, changeTotals, CREW_ROLES, EQUIPMENT, fmtNum, type Report, type ReportChange } from "@/lib/bautagebuch-shared";

type Crew = { name: string; userId?: string | null; hours?: number | null; role?: string | null };
type Entry = { weather: string | null; crew: Crew[]; work: string | null; material: string | null; obstacles: string | null; visitors: string | null; report: Report };
type Texts = { work: string; material: string; obstacles: string; visitors: string; orders: string };

// Bautagesbericht eines Tages im Aufbau des Kunden-Formulars: Kopf, Witterung, 1. Arbeitseinsatz, 2. Geräteeinsatz,
// 3. Ausgeführte Arbeiten + Änderungen (Mann × Std.), 4. Besondere Vorkommnisse + Anordnungen. Texte auch per Diktat.
export function DiaryForm({ projectId, day, entry, defaults, wx, users, suggestion }: { projectId: string; day: string; entry: Entry | null; defaults: Report; wx: { temp: number | null; sun: boolean; rain: boolean; snow: boolean }; users: { id: string; name: string }[]; suggestion: Crew[] }) {
  const r = entry?.report ?? defaults;
  const [crew, setCrew] = useState<Crew[]>(entry?.crew.length ? entry.crew : suggestion);
  const [texts, setTexts] = useState<Texts>({ work: entry?.work ?? "", material: entry?.material ?? "", obstacles: entry?.obstacles ?? "", visitors: entry?.visitors ?? "", orders: r.orders ?? "" });
  const [changes, setChanges] = useState<ReportChange[]>(r.changes?.length ? r.changes : []);
  const [flags, setFlags] = useState({ sun: wx.sun, rain: wx.rain, snow: wx.snow });
  const [manual, setManual] = useState(r.sun != null || r.rain != null || r.snow != null);
  const [rec, setRec] = useState<string | null>(null);
  const dictate = (k: keyof Texts) => {
    if (!speechSupported()) return alert("Diktat geht in Chrome, Edge und Safari.");
    setRec(k);
    listen({ onFinal: (t) => setTexts((x) => ({ ...x, [k]: x[k] ? `${x[k]} ${t}` : t })), onEnd: () => setRec(null), onError: () => setRec(null) });
  };
  const field = (k: keyof Texts, label: string, ph: string, rows = 3) => (
    <label className="block text-xs font-semibold text-steel sm:col-span-2">
      <span className="flex items-center justify-between">
        {label}
        <button type="button" onClick={() => dictate(k)} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${rec === k ? "bg-bad text-white" : "text-brand"}`} aria-label={`${label} diktieren`}>
          <Mic className="size-3.5" /> {rec === k ? "hört zu …" : "diktieren"}
        </button>
      </span>
      <textarea name={k === "orders" ? "rOrders" : k} rows={rows} value={texts[k]} onChange={(e) => setTexts((x) => ({ ...x, [k]: e.target.value }))} placeholder={ph} className="input mt-1 resize-y font-normal" />
    </label>
  );
  const small = (name: string, label: string, value: string | number | null | undefined, opts: { type?: string; ph?: string; mode?: "decimal" | "numeric" } = {}) => (
    <label className="block text-xs font-semibold text-steel">
      {label}
      <input name={name} type={opts.type ?? "text"} inputMode={opts.mode} defaultValue={value ?? ""} placeholder={opts.ph} className="input mt-1 font-normal" />
    </label>
  );
  const head = (t: string) => <h3 className="border-l-4 border-brand bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-2 sm:col-span-2">{t}</h3>;
  const numIn = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const setCh = (k: number, patch: Partial<ReportChange>) => setChanges((x) => x.map((c, n) => (n === k ? { ...c, ...patch } : c)));
  const tot = changeTotals(changes);
  const hrs = crew.reduce((s, c) => s + (c.hours ?? 0), 0);

  return (
    <StateForm action={saveDiaryEntry} className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0" submit="Bericht speichern">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="wxManual" value={manual ? "1" : ""} />

      <div className="grid grid-cols-[6rem_1fr] gap-3 sm:col-span-2 sm:grid-cols-[6rem_1fr_1fr]">
        {small("rNo", "Bericht-Nr.", r.no, { mode: "numeric" })}
        {small("rForeman", "Ausführender Richtmeister", r.foreman, { ph: "Name" })}
        <div className="col-span-2 sm:col-span-1">{small("rTrade", "Gewerk", r.trade, { ph: "z. B. Stahlbau / Treppen" })}</div>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs font-semibold text-steel">Witterung</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-semibold text-steel">
            Temperatur °C
            <input name="rTemp" inputMode="decimal" defaultValue={r.temp ?? ""} placeholder={wx.temp === null ? "" : String(wx.temp)} className="input mt-1 w-24 font-normal" />
          </label>
          {(["sun", "rain", "snow"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <input type="checkbox" name={k === "sun" ? "rSun" : k === "rain" ? "rRain" : "rSnow"} value="1" checked={flags[k]} onChange={(e) => { setManual(true); setFlags((f) => ({ ...f, [k]: e.target.checked })); }} className="size-4 accent-brand" />
              {k === "sun" ? "Sonne" : k === "rain" ? "Regen" : "Schnee"}
            </label>
          ))}
        </div>
        <input name="weather" defaultValue={entry?.weather ?? ""} placeholder={entry?.weather ? "" : "leer lassen = automatisch vom Wetterdienst"} className="input font-normal" aria-label="Wetter als Text" />
        {!manual && <p className="text-xs text-steel">Sonne/Regen/Schnee und Temperatur kommen automatisch aus dem Wetter – ankreuzen überschreibt.</p>}
      </div>

      {head("1. Arbeitseinsatz")}
      <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
        {small("rEarlyFrom", "Früh-/Tagschicht von", r.earlyFrom, { type: "time" })}
        {small("rEarlyTo", "bis", r.earlyTo, { type: "time" })}
        {small("rLateFrom", "Spät-/Nachtschicht von", r.lateFrom, { type: "time" })}
        {small("rLateTo", "bis", r.lateTo, { type: "time" })}
      </div>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs font-semibold text-steel">Personal auf der Baustelle {crew.length > 0 && <span className="font-normal">· {crew.length} {crew.length === 1 ? "Person" : "Personen"}{hrs ? ` · ${fmtNum(hrs)} Std.` : ""}</span>}</p>
        {crew.map((c, k) => (
          <div key={k} className="flex flex-wrap gap-2 sm:flex-nowrap">
            <input type="hidden" name="crewUserId" value={c.userId ?? ""} />
            <select name="crewRole" value={c.role ?? "Monteur"} onChange={(e) => setCrew((x) => x.map((y, n) => (n === k ? { ...y, role: e.target.value } : y)))} className="input w-full sm:w-36" aria-label="Funktion">
              {CREW_ROLES.map((role) => <option key={role} value={role}>{role === "Sonstige" ? "übrige Beschäftigte" : role}</option>)}
            </select>
            <input name="crewName" list="diary-users" value={c.name} onChange={(e) => setCrew((x) => x.map((y, n) => (n === k ? { ...y, name: e.target.value, userId: users.find((u) => u.name === e.target.value)?.id ?? null } : y)))} placeholder="Name (auch Subunternehmer)" className="input min-w-0 flex-1" aria-label="Name" />
            <input name="crewHours" inputMode="decimal" value={c.hours ?? ""} onChange={(e) => setCrew((x) => x.map((y, n) => (n === k ? { ...y, hours: numIn(e.target.value) } : y)))} placeholder="Std." className="input w-20" aria-label="Stunden" />
            <button type="button" onClick={() => setCrew((x) => x.filter((_, n) => n !== k))} className="btn-secondary px-2" aria-label="Zeile entfernen"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <datalist id="diary-users">{users.map((u) => <option key={u.id} value={u.name} />)}</datalist>
        <button type="button" onClick={() => setCrew((x) => [...x, { name: "", hours: null, role: "Monteur" }])} className="btn-secondary text-xs"><Plus className="size-4" /> Person</button>
        {suggestion.length > 0 && !entry && <p className="text-xs text-steel">Vorschlag aus gebuchten Stunden und dem Montage-Team.</p>}
      </div>
      {field("visitors", "Bemerkungen / Besuche", "z. B. Fachbauleiter Hr. Schmidt vor Ort, Abnahme Podest", 2)}

      {head("2. Geräteeinsatz")}
      <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
        {EQUIPMENT.map(([k, label]) => <div key={k}>{small(`eq_${k}`, label, r.equipment?.[k], { ph: "z. B. 1 × 6 Std." })}</div>)}
      </div>
      {field("material", "Material / Lieferungen", "z. B. Gitterroste geliefert (Lieferschein 4711)", 2)}

      {head("3. Ausgeführte Arbeiten")}
      {field("work", "Ausgeführte Arbeiten", "z. B. Podest gesetzt, Treppenwangen ausgerichtet und verschraubt, 8 Stufen montiert", 4)}
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs font-semibold text-steel">Änderungen / Zusatzleistungen <span className="font-normal">(∑ Stunden = Mann × Std.)</span></p>
        {changes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-steel">
                <tr><th className="w-20 pb-1">Mann</th><th className="w-20 pb-1">Std.</th><th className="w-20 pb-1 pr-3 text-right">∑ Std.</th><th className="w-24 pb-1">Kran-Std.</th><th className="w-24 pb-1">Bühnen</th><th className="pb-1">Beschreibung</th><th className="w-10" /></tr>
              </thead>
              <tbody>
                {changes.map((c, k) => (
                  <tr key={k}>
                    {(["men", "hours"] as const).map((f) => <td key={f} className="pr-1 py-0.5"><input name={f === "men" ? "chMen" : "chHours"} inputMode="decimal" value={c[f] ?? ""} onChange={(e) => setCh(k, { [f]: numIn(e.target.value) })} className="input px-2 py-1.5" /></td>)}
                    <td className="pr-3 text-right font-medium tabular-nums">{fmtNum(changeHours(c))}</td>
                    {(["crane", "platforms"] as const).map((f) => <td key={f} className="pr-1"><input name={f === "crane" ? "chCrane" : "chPlatforms"} inputMode="decimal" value={c[f] ?? ""} onChange={(e) => setCh(k, { [f]: numIn(e.target.value) })} className="input px-2 py-1.5" /></td>)}
                    <td className="pr-1"><input name="chText" value={c.text ?? ""} onChange={(e) => setCh(k, { text: e.target.value })} placeholder="z. B. Zusatzhandlauf Wandseite" className="input px-2 py-1.5" /></td>
                    <td><button type="button" onClick={() => setChanges((x) => x.filter((_, n) => n !== k))} className="btn-secondary px-2" aria-label="Zeile entfernen"><Trash2 className="size-4" /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line font-semibold">
                <tr><td className="pt-1">Summe</td><td /><td className="pt-1 pr-3 text-right tabular-nums">{fmtNum(tot.hours)}</td><td className="pt-1 pl-2 tabular-nums">{fmtNum(tot.crane)}</td><td className="pt-1 pl-2 tabular-nums">{fmtNum(tot.platforms)}</td><td colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <button type="button" onClick={() => setChanges((x) => [...x, { men: null, hours: null, crane: null, platforms: null, text: "" }])} className="btn-secondary text-xs"><Plus className="size-4" /> Änderung</button>
      </div>

      {head("4. Besondere Vorkommnisse")}
      {field("obstacles", "Besondere Vorkommnisse / Behinderungen", "z. B. Baustelle erst ab 9 Uhr frei, Estrich noch nass", 2)}
      {field("orders", "Anordnungen", "z. B. Anfahrtspauschale 78,– · Handlauf auf 1,00 m statt 0,90 m", 2)}
    </StateForm>
  );
}
