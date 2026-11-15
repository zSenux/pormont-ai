import Link from "next/link";
import { AlertTriangle, CheckCircle2, Gauge, Settings2, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { capacityWeeks, fitCheck, fmtH, hoursFromQuote } from "@/lib/kapazitaet";
import { saveCapacitySettings } from "@/app/actions/kapazitaet";
import { StateForm } from "@/components/state-form";

export const metadata = { title: "Kapazität Werkstatt" };
export const dynamic = "force-dynamic";

const tone = (pct: number) => (pct > 100 ? "bg-bad" : pct > 85 ? "bg-warn" : "bg-brand");
const cell = (pct: number, cap: number) => (cap <= 0 ? "bg-mist text-steel" : pct > 100 ? "bg-red-100 text-bad" : pct > 85 ? "bg-amber-100 text-warn" : pct > 40 ? "bg-brand-soft text-brand-2" : "bg-green-50 text-ok");
const dm = (ymd: string) => `${ymd.slice(8)}.${ymd.slice(5, 7)}.`;

export default async function KapazitaetPage({ searchParams }: { searchParams: Promise<{ stunden?: string; bis?: string; angebot?: string; ungeplant?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const r = await capacityWeeks(8);
  const max = Math.max(1, ...r.weeks.map((w) => Math.max(w.capacity, w.load)));
  const [quotes, users] = await Promise.all([
    db.salesDoc.findMany({ where: { kind: "ANGEBOT", status: { in: ["OFFEN", "ENTWURF"] } }, orderBy: { date: "desc" }, take: 30, select: { id: true, number: true, title: true, customer: { select: { name: true } } } }),
    me.role === "ADMIN" ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  // „Passt das rein?“
  let quoteHours: Awaited<ReturnType<typeof hoursFromQuote>> = null;
  if (sp.angebot && /^c[a-z0-9]{20,}$/.test(sp.angebot)) quoteHours = await hoursFromQuote(sp.angebot);
  const hours = quoteHours?.hours ?? (Number(String(sp.stunden ?? "").replace(",", ".")) || 0);
  const by = /^\d{4}-\d{2}-\d{2}$/.test(sp.bis ?? "") ? sp.bis! : null;
  const fit = hours > 0 && hours <= 5000 ? await fitCheck(hours, by, { includeUnplanned: sp.ungeplant === "1" }) : null;

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <Link href="/fertigung" className="text-sm text-steel hover:text-brand">← Fertigung</Link>
        <h1 className="page-title mt-1">Kapazität Werkstatt</h1>
        <p className="mt-1 text-sm text-steel">Auslastung je Woche aus den Fertigungskarten gegen die verfügbaren Stunden des Werkstatt-Teams (ohne Urlaub, Krankheit und Feiertage). Oder Jarvis fragen: „Passt ein Auftrag mit 120 Stunden bis Mitte Januar rein?“</p>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold"><Gauge className="size-4 text-brand" /> Nächste 8 Wochen</h2>
          <p className="text-xs text-steel">Team: {r.team.map((u) => u.name).join(", ") || "–"} · {r.cfg.hoursPerDay} Std./Tag · {r.cfg.productivePct} % produktiv</p>
        </div>
        <div className="mt-4 grid grid-cols-8 items-end gap-2" style={{ height: "13rem" }}>
          {r.weeks.map((w) => (
            <div key={w.start} className="flex h-full flex-col justify-end" title={`KW ${w.kw}: ${fmtH(w.load)} von ${fmtH(w.capacity)}`}>
              <p className={clsx("mb-1 text-center text-xs font-semibold", w.pct > 100 ? "text-bad" : "text-steel")}>{w.capacity ? `${Math.round(w.pct)} %` : "–"}</p>
              <div className="relative mx-auto w-full max-w-14 flex-1">
                <div className="absolute inset-x-0 bottom-0 rounded-t-md border-2 border-dashed border-brand/40" style={{ height: `${(w.capacity / max) * 100}%` }} />
                <div className={clsx("absolute inset-x-1.5 bottom-0 rounded-t-md", tone(w.pct))} style={{ height: `${(Math.min(w.load, max) / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-8 gap-2 text-center text-xs">
          {r.weeks.map((w) => (
            <div key={w.start}>
              <p className="font-semibold">KW {w.kw}</p>
              <p className="text-steel">{dm(w.start)}</p>
              <p className="text-steel">{Math.round(w.load)}/{Math.round(w.capacity)} h</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-4 text-xs text-steel">
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm border-2 border-dashed border-brand/40" /> verfügbar</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-brand" /> geplant</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-warn" /> über 85 %</span>
          <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-bad" /> überbucht</span>
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <section className="card p-5">
          <h2 className="font-semibold">Je Mitarbeiter</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-xs">
              <thead><tr><th className="text-left font-medium text-steel">Mitarbeiter</th>{r.weeks.map((w) => <th key={w.start} className="font-medium text-steel">KW {w.kw}</th>)}</tr></thead>
              <tbody>
                {r.team.map((u) => (
                  <tr key={u.id}>
                    <td className="pr-2 font-medium">{u.name}</td>
                    {r.weeks.map((w) => {
                      const p = w.people[u.id];
                      const pct = p.capacity > 0 ? (p.load / p.capacity) * 100 : p.load > 0 ? 999 : 0;
                      return <td key={w.start} className={clsx("rounded-md px-1 py-1.5 text-center font-semibold", cell(pct, p.capacity))} title={`${Math.round(p.load)} von ${Math.round(p.capacity)} Std.`}>{p.capacity <= 0 ? (p.load > 0 ? `${Math.round(p.load)} h!` : w.capacity <= 0 ? "–" : "abw.") : `${Math.round(pct)} %`}</td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="pr-2 text-steel">nicht zugeteilt</td>
                  {r.weeks.map((w) => <td key={w.start} className="text-center text-steel">{w.unassigned ? `${Math.round(w.unassigned)} h` : "–"}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          {r.weeks.some((w) => w.absences.length) && (
            <p className="mt-2 text-xs text-steel">Abwesend: {r.weeks.filter((w) => w.absences.length).map((w) => `KW ${w.kw} ${w.absences.join(", ")}`).join(" · ")}</p>
          )}
          {(r.unplanned.length > 0 || r.overdue.length > 0) && (
            <div className="mt-4 space-y-2 text-sm">
              {r.overdue.length > 0 && <p className="flex items-start gap-2 text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Überfällig (Rest in dieser Woche eingerechnet): {r.overdue.map((j) => <Link key={j.id} href={`/fertigung/${j.id}`} className="underline">{j.number}</Link>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), [])}</p>}
              {r.unplanned.length > 0 && (
                <div>
                  <p className="font-medium">Ohne Termin – nicht eingerechnet ({fmtH(r.unplannedHours)}):</p>
                  <ul className="mt-1 list-disc pl-5 text-steel">{r.unplanned.map((j) => <li key={j.id}><Link href={`/fertigung/${j.id}`} className="underline">{j.number}</Link> {j.title} · {j.project.name} · {fmtH(j.plannedHours ?? 0)}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Passt ein neuer Auftrag rein?</h2>
          <form action="/fertigung/kapazitaet" className="grid gap-2">
            <select name="angebot" defaultValue={sp.angebot ?? ""} className="input" aria-label="Angebot">
              <option value="">– Stunden selbst eingeben –</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.number ?? "Entwurf"} · {q.customer?.name ?? ""} · {q.title ?? ""}</option>)}
            </select>
            <label className="text-xs text-steel">Werkstattstunden <input name="stunden" inputMode="decimal" defaultValue={quoteHours ? "" : sp.stunden ?? ""} placeholder="z. B. 120" className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Fertig bis (optional) <input type="date" name="bis" defaultValue={by ?? ""} className="input mt-1 w-full" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ungeplant" value="1" defaultChecked={sp.ungeplant === "1"} className="size-4 accent-brand" /> Karten ohne Termin vorher einplanen</label>
            <button className="btn-primary">Prüfen</button>
          </form>
          {quoteHours && <p className="text-xs text-steel">Aus Angebot {quoteHours.doc.number ?? "(Entwurf)"}: {fmtH(quoteHours.hours)}{quoteHours.estimated ? " – geschätzt (40 % Lohnanteil ÷ Stundensatz), keine Std.-Positionen im Angebot" : " aus den Stunden-Positionen"}.</p>}
          {fit && (
            <div className={clsx("rounded-xl p-4 text-sm", fit.ok ? "bg-green-50" : "bg-red-50")}>
              <p className={clsx("flex items-center gap-2 font-semibold", fit.ok ? "text-ok" : "text-bad")}>
                {fit.ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
                {fit.finish ? (fit.ok ? `Passt – fertig in KW ${fit.finish.kw}` : `Knapp: frühestens KW ${fit.finish.kw} fertig`) : "Passt im nächsten halben Jahr nicht rein"}
              </p>
              <p className="mt-1">{fmtH(fit.hours)}{sp.ungeplant === "1" ? ` + ${fmtH(fit.unplannedHours)} ohne Termin` : ""}{fit.finish ? `, frühestens fertig bis ${formatDate(berlinDateTime(fit.finish.end))}` : ""}{by ? ` · gewünscht bis ${formatDate(berlinDateTime(by))}` : ""}.</p>
              {fit.used.length > 0 && <p className="mt-1 text-xs text-steel">Verteilung auf freie Stunden: {fit.used.map((u) => `KW ${u.kw}: ${Math.round(u.hours)} h`).join(" · ")}</p>}
              {!fit.ok && <p className="mt-1 text-xs">Optionen: Überstunden/Samstage, Aushilfe oder Nachunternehmer, andere Karten verschieben – oder späteren Termin anbieten.</p>}
            </div>
          )}
        </section>
      </div>

      {me.role === "ADMIN" && (
        <details className="card p-5">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Settings2 className="size-4 text-brand" /> Einstellungen</summary>
          <StateForm action={saveCapacitySettings} className="mt-3 space-y-3" submit="Speichern">
            <fieldset>
              <legend className="text-sm font-medium">Werkstatt-Team (leer = alle mit Funktion Fertigung)</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {users.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="userIds" value={u.id} defaultChecked={r.cfg.userIds.includes(u.id)} className="size-4 accent-brand" /> {u.name}</label>)}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-steel">Stunden je Tag <input name="hoursPerDay" inputMode="decimal" defaultValue={r.cfg.hoursPerDay} className="input mt-1 block w-28" /></label>
              <label className="text-xs text-steel">davon produktiv % <input name="productivePct" type="number" min={30} max={100} defaultValue={r.cfg.productivePct} className="input mt-1 block w-28" /></label>
            </div>
          </StateForm>
        </details>
      )}
    </main>
  );
}
