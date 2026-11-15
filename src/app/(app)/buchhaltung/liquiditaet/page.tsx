import Link from "next/link";
import { AlertTriangle, Landmark, Plus, Sparkles, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { clsx } from "clsx";
import { berlinDateTime, formatDate, todayYmd } from "@/lib/berlin";
import { forecast, INTERVALS, INTERVAL_KEYS, isoWeek, type Interval } from "@/lib/buchhaltung/liquiditaet";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { addCashItem, deleteCashItem, saveBalance } from "@/app/actions/liquiditaet";
import { StateForm } from "@/components/state-form";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Liquidität" };
export const dynamic = "force-dynamic";

const euro0 = (c: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(c / 100);
const d = (ymd: string) => formatDate(berlinDateTime(ymd, "12:00"));

export default async function Liquiditaet() {
  const f = await forecast();
  const max = Math.max(1, ...f.weeks.map((w) => Math.abs(w.balanceCents)), f.cfg.reserveCents, Math.abs(f.balance.cents));
  const flowMax = Math.max(1, ...f.weeks.flatMap((w) => [w.inCents, w.outCents]));
  const end = f.weeks.at(-1)!;
  const warn = f.negative ?? f.belowReserve;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Liquidität</h1>
          <p className="mt-1 text-sm text-steel">Vorschau der nächsten {f.weeks.length} Wochen aus offenen Rechnungen, offenen Ausgaben, Spesen und geplanten Zahlungen.</p>
        </div>
        <Link href={`/jarvis?q=${encodeURIComponent("Wie sieht unsere Liquidität in den nächsten Wochen aus? Wo wird es eng, und welche Rechnungen sollten wir nachfassen?")}`} className="btn-secondary"><Sparkles className="size-4" /> Jarvis fragen</Link>
      </div>

      {warn ? (
        <p className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{f.negative ? `Das Konto rutscht in KW ${isoWeek(f.negative.start)} (ab ${d(f.negative.start)}) ins Minus: ${fmtEuroCents(f.negative.balanceCents)}.` : `In KW ${isoWeek(warn.start)} (ab ${d(warn.start)}) unter der Reserve von ${fmtEuroCents(f.cfg.reserveCents)}: ${fmtEuroCents(warn.balanceCents)}.`} Offene Rechnungen nachfassen oder Ausgaben schieben.</span>
        </p>
      ) : (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-ok">Die Reserve von {fmtEuroCents(f.cfg.reserveCents)} wird in allen {f.weeks.length} Wochen gehalten.</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-steel">Kontostand jetzt{f.balance.known ? "" : " (fehlt)"}</p><p className="text-2xl font-extrabold">{fmtEuroCents(f.balance.cents)}</p><p className="text-xs text-steel">{f.balance.known ? `Eingabe ${d(f.balance.asOf!)}${f.balance.bankCount ? ` + ${f.balance.bankCount} Bankumsätze` : ""}` : "unten eintragen"}</p></div>
        <div className="card p-4"><p className="flex items-center gap-1 text-xs text-steel"><TrendingUp className="size-3.5 text-ok" /> Eingänge</p><p className="text-2xl font-extrabold text-ok">{fmtEuroCents(f.totalIn)}</p>{f.overdueIn > 0 && <p className="text-xs text-bad">davon überfällig {fmtEuroCents(f.overdueIn)}</p>}</div>
        <div className="card p-4"><p className="flex items-center gap-1 text-xs text-steel"><TrendingDown className="size-3.5 text-bad" /> Ausgänge</p><p className="text-2xl font-extrabold text-bad">{fmtEuroCents(f.totalOut)}</p>{f.overdueOut > 0 && <p className="text-xs text-bad">davon überfällig {fmtEuroCents(f.overdueOut)}</p>}</div>
        <div className="card p-4"><p className="text-xs text-steel">Stand in {f.weeks.length} Wochen</p><p className={clsx("text-2xl font-extrabold", end.balanceCents < 0 ? "text-bad" : "text-ink")}>{fmtEuroCents(end.balanceCents)}</p><p className="text-xs text-steel">tiefster Stand {euro0(f.lowest.balanceCents)} (KW {isoWeek(f.lowest.start)})</p></div>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Kontostand je Woche</h2>
        <p className="mb-4 text-xs text-steel">Balken = Stand am Wochenende, grün/rot = Ein- und Ausgänge der Woche. Gestrichelt: Reserve.</p>
        <div className="overflow-x-auto">
          <div className="relative flex h-56 min-w-[40rem] items-end gap-2 border-b border-line">
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-warn" style={{ bottom: `${Math.max(0, (f.cfg.reserveCents / max) * 100)}%` }} />
            {f.weeks.map((w) => (
              <div key={w.start} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`KW ${isoWeek(w.start)}: +${fmtEuroCents(w.inCents)} / −${fmtEuroCents(w.outCents)} → ${fmtEuroCents(w.balanceCents)}`}>
                <span className={clsx("mb-1 text-[10px] font-semibold", w.balanceCents < 0 ? "text-bad" : "text-steel")}>{euro0(w.balanceCents)}</span>
                <div className={clsx("w-full rounded-t-md", w.balanceCents < 0 ? "bg-bad" : w.balanceCents < f.cfg.reserveCents ? "bg-warn" : "bg-brand")} style={{ height: `${Math.max(2, (Math.abs(w.balanceCents) / max) * 80)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex min-w-[40rem] gap-2 pt-1">
            {f.weeks.map((w) => (
              <div key={w.start} className="flex-1 text-center text-[10px] text-steel">
                <div className="mx-auto flex h-8 items-end justify-center gap-0.5">
                  <span className="w-2 rounded-t bg-ok" style={{ height: `${(w.inCents / flowMax) * 100}%` }} />
                  <span className="w-2 rounded-t bg-bad" style={{ height: `${(w.outCents / flowMax) * 100}%` }} />
                </div>
                KW {isoWeek(w.start)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card divide-y divide-line">
        <h2 className="p-5 pb-3 font-semibold">Woche für Woche</h2>
        {f.weeks.map((w) => (
          <details key={w.start} className="group px-5 py-3" open={w.items.some((i) => i.overdue)}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="w-40 font-medium">KW {isoWeek(w.start)} · {d(w.start).slice(0, 6)}–{d(w.end).slice(0, 6)}</span>
              <span className="text-ok">+{fmtEuroCents(w.inCents)}</span>
              <span className="text-bad">−{fmtEuroCents(w.outCents)}</span>
              <span className={clsx("ml-auto font-semibold", w.balanceCents < 0 ? "text-bad" : w.balanceCents < f.cfg.reserveCents ? "text-warn" : "")}>{fmtEuroCents(w.balanceCents)}</span>
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {w.items.length === 0 && <li className="text-xs text-steel">Keine Zahlungen geplant.</li>}
              {w.items.map((i, k) => (
                <li key={k} className="flex gap-3">
                  <span className="w-14 text-xs text-steel">{d(i.day).slice(0, 6)}</span>
                  {i.url ? <Link href={i.url} className={clsx("min-w-0 flex-1 truncate", i.overdue && "text-bad")}>{i.label}</Link> : <span className="min-w-0 flex-1 truncate">{i.label}</span>}
                  <span className={i.cents > 0 ? "text-ok" : "text-bad"}>{i.cents > 0 ? "+" : "−"}{fmtEuroCents(Math.abs(i.cents))}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {f.laterIn > 0 && <p className="px-5 py-3 text-xs text-steel">Danach noch fällig: {fmtEuroCents(f.laterIn)} aus offenen Rechnungen.</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Landmark className="size-4 text-brand" /> Kontostand & Reserve</h2>
          <p className="text-xs text-steel">Einmal den Kontostand laut Bank eintragen. Danach rechnet Jarvis die eingelesenen Bankumsätze (Bankabgleich) automatisch dazu.</p>
          <StateForm action={saveBalance} className="grid gap-2 sm:grid-cols-2" submit="Speichern">
            <label className="text-xs text-steel">Kontostand (€)<input name="balance" required inputMode="decimal" defaultValue={f.cfg.balanceCents !== null ? (f.cfg.balanceCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 }) : ""} className="input mt-1" /></label>
            <label className="text-xs text-steel">am<input name="asOf" type="date" defaultValue={f.cfg.asOf ?? todayYmd()} className="input mt-1" /></label>
            <label className="text-xs text-steel">Mindestreserve (€)<input name="reserve" inputMode="decimal" defaultValue={(f.cfg.reserveCents / 100).toLocaleString("de-DE")} className="input mt-1" /></label>
            <label className="text-xs text-steel">Wochen voraus<input name="weeks" type="number" min={4} max={26} defaultValue={f.cfg.weeks} className="input mt-1" /></label>
          </StateForm>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Geplante Zahlungen</h2>
          <p className="text-xs text-steel">Was nicht als Rechnung im System ist: Löhne, Miete, Leasing, Versicherungen, Steuern – oder ein erwarteter Abschlag.</p>
          <StateForm action={addCashItem} reset className="grid gap-2 sm:grid-cols-2" submit="Hinzufügen">
            <input name="name" required placeholder="z. B. Löhne und Gehälter" className="input sm:col-span-2" aria-label="Bezeichnung" />
            <select name="dir" className="input" aria-label="Richtung"><option value="out">Ausgang (−)</option><option value="in">Eingang (+)</option></select>
            <input name="amount" required inputMode="decimal" placeholder="Betrag €" className="input" aria-label="Betrag" />
            <select name="interval" defaultValue="MONATLICH" className="input" aria-label="Rhythmus">{INTERVAL_KEYS.map((k) => <option key={k} value={k}>{INTERVALS[k]}</option>)}</select>
            <label className="text-xs text-steel">erste Fälligkeit<input name="start" type="date" required defaultValue={todayYmd()} className="input mt-1" /></label>
          </StateForm>
          <ul className="divide-y divide-line text-sm">
            {f.plans.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-xs text-steel">· {INTERVALS[p.interval as Interval] ?? p.interval} ab {formatDate(p.startDate)}</span></span>
                <span className={p.amountCents > 0 ? "text-ok" : "text-bad"}>{fmtEuroCents(p.amountCents)}</span>
                <ActionButton action={deleteCashItem.bind(null, p.id)} confirm={`„${p.name}“ löschen?`} className="text-steel/60 hover:text-bad" title="Löschen"><Trash2 className="size-4" /></ActionButton>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-xs text-steel">Nicht enthalten: Angebote und Aufträge ohne Rechnung, Bestellungen ohne Eingangsrechnung, Umsatzsteuer-Vorauszahlungen (als geplante Zahlung eintragen). Keine Steuer- oder Finanzberatung.</p>
    </div>
  );
}
