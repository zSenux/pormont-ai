import { berlinParts } from "@/lib/berlin";

type A = { title: string; startAt: Date; endAt: Date | null; address: string | null; vehicle: string | null; leaderId: string | null; plan: string | null; crew: { userId: string }[] } | null;

/** Formularfelder für Montage anlegen/bearbeiten (Server-Komponente, Team per Checkbox) */
export function AssemblyFields({ a, users, vehicles }: { a: A; users: { id: string; name: string }[]; vehicles: string[] }) {
  const s = a ? berlinParts(a.startAt) : null;
  const e = a?.endAt ? berlinParts(a.endAt) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = a?.endAt && s && e && e.ymd !== s.ymd ? Math.round((Date.parse(e.ymd) - Date.parse(s.ymd)) / 86400_000) + 1 : 1;
  return (
    <>
      <input name="title" required minLength={2} defaultValue={a?.title ?? ""} placeholder="z. B. Montage Treppe + Podest" className="input sm:col-span-2" aria-label="Bezeichnung" />
      <label className="text-xs text-steel">Tag<input name="date" type="date" required defaultValue={s?.ymd ?? ""} className="input mt-1 w-full" /></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-steel">Beginn<input name="from" type="time" defaultValue={s ? `${pad(s.h)}:${pad(s.min)}` : "07:00"} className="input mt-1 w-full" /></label>
        <label className="text-xs text-steel">Ende<input name="to" type="time" defaultValue={e ? `${pad(e.h)}:${pad(e.min)}` : "16:00"} className="input mt-1 w-full" /></label>
        <label className="text-xs text-steel">Tage<input name="days" type="number" min={1} max={30} defaultValue={days} className="input mt-1 w-full" /></label>
      </div>
      <input name="address" defaultValue={a?.address ?? ""} placeholder="Baustellenadresse (leer = aus Projekt)" className="input sm:col-span-2" aria-label="Adresse" />
      <input name="vehicle" list="fahrzeuge" defaultValue={a?.vehicle ?? ""} placeholder="Fahrzeug, z. B. Sprinter MA-PM 210" className="input" aria-label="Fahrzeug" />
      <datalist id="fahrzeuge">{vehicles.map((v) => <option key={v} value={v} />)}</datalist>
      <select name="leaderId" defaultValue={a?.leaderId ?? ""} className="input" aria-label="Montageleitung">
        <option value="">Montageleitung</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs text-steel">Montageteam</legend>
        <div className="flex flex-wrap gap-2">
          {users.map((u) => (
            <label key={u.id} className="chip cursor-pointer gap-1.5 bg-white px-3 py-1 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand">
              <input type="checkbox" name="crew" value={u.id} defaultChecked={a?.crew.some((c) => c.userId === u.id)} className="accent-[#0f4d83]" /> {u.name}
            </label>
          ))}
        </div>
      </fieldset>
      <textarea name="plan" rows={3} defaultValue={a?.plan ?? ""} placeholder="Montageplan / Hinweise: Ablauf, Kran/Hebebühne, Ansprechpartner vor Ort, Zufahrt …" className="input resize-y sm:col-span-2" aria-label="Montageplan" />
    </>
  );
}
