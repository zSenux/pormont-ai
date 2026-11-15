import Link from "next/link";
import { BarChart3, ChevronLeft, ChevronRight, Lock, Package, Trophy, Users } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { berlinParts } from "@/lib/berlin";
import { yearReport } from "@/lib/auswertung";

export const metadata = { title: "Jahresauswertung" };
export const dynamic = "force-dynamic";

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)} %`);
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const marginTone = (p: number | null) => (p === null ? "text-steel" : p < 0 ? "text-bad" : p < 15 ? "text-warn" : "text-ok");

function Bar({ value, max, tone = "bg-brand" }: { value: number; max: number; tone?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-mist">
      <div className={clsx("h-2 rounded-full", value < 0 ? "bg-bad" : tone)} style={{ width: `${Math.min(100, (Math.abs(value) / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}

export default async function Auswertung({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const me = await requireUser();
  const full = me.role === "ADMIN" || me.funktion === "GF";
  const sp = await searchParams;
  const now = berlinParts().y;
  const year = Number(sp.jahr) >= 2000 && Number(sp.jahr) <= now ? Number(sp.jahr) : now;
  const r = await yearReport(year);
  const maxMonth = Math.max(1, ...r.months);
  const maxCust = Math.max(1, ...r.customers.map((c) => c.revenue));
  const maxGroup = Math.max(1, ...r.groups.map((g) => Math.abs(g.margin)));
  const maxItem = Math.max(1, ...r.items.map((x) => x.revenue));
  const maxTeam = Math.max(1, ...r.team.map((p) => Math.abs(p.margin)));

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Jahresauswertung {year}</h1>
          <p className="mt-1 text-sm text-steel">Welche Kunden, Produkte und Monteure bringen am meisten? Aus Rechnungen, Nachkalkulation und Stunden – alles netto. Oder Jarvis fragen: „Wer war dieses Jahr unser bester Kunde?“</p>
        </div>
        <div className="flex gap-1">
          <Link href={`/auswertung?jahr=${year - 1}`} className="btn-secondary px-2" aria-label="Vorjahr"><ChevronLeft className="size-4" /></Link>
          <Link href="/auswertung" className="btn-secondary">{now}</Link>
          {year < now && <Link href={`/auswertung?jahr=${year + 1}`} className="btn-secondary px-2" aria-label="Folgejahr"><ChevronRight className="size-4" /></Link>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-sm text-steel">Umsatz netto</p><p className="text-2xl font-extrabold text-brand">{eur(r.revenue)}</p><p className="text-xs text-steel">{r.invoices} Rechnungen</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Deckungsbeitrag</p><p className={clsx("text-2xl font-extrabold", marginTone(r.marginPct))}>{eur(r.margin)}</p><p className="text-xs text-steel">{pct(r.marginPct)} vom Auftragswert</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Projekte</p><p className="text-2xl font-extrabold">{r.projects}</p><p className="text-xs text-steel">nachkalkuliert</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Kunden</p><p className="text-2xl font-extrabold">{r.customers.length}</p><p className="text-xs text-steel">mit Umsatz</p></div>
      </div>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><BarChart3 className="size-4 text-brand" /> Umsatz je Monat</h2>
        <div className="mt-4 grid grid-cols-12 items-end gap-1.5" style={{ height: "9rem" }}>
          {r.months.map((m, i) => (
            <div key={i} className="flex h-full flex-col justify-end" title={`${MONTHS[i]}: ${eur(m)}`}>
              <div className="rounded-t-md bg-brand" style={{ height: `${(Math.max(0, m) / maxMonth) * 100}%`, minHeight: m > 0 ? 3 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-12 gap-1.5 text-center text-[11px] text-steel">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Trophy className="size-4 text-brand" /> Kunden</h2>
          <p className="text-xs text-steel">Umsatz netto · Deckungsbeitrag aus der Nachkalkulation ihrer Projekte</p>
          <ol className="mt-3 space-y-3">
            {r.customers.slice(0, 10).map((c, i) => (
              <li key={c.name + i} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate"><span className="mr-1.5 text-steel">{i + 1}.</span>{c.id ? <Link href={`/buchhaltung/kunden/${c.id}`} className="font-medium hover:underline">{c.name}</Link> : <span className="font-medium">{c.name}</span>}</span>
                  <span className="shrink-0 font-semibold">{eur(c.revenue)}</span>
                </div>
                <Bar value={c.revenue} max={maxCust} />
                <p className="mt-0.5 text-xs text-steel">{c.invoices} {c.invoices === 1 ? "Rechnung" : "Rechnungen"} · {c.projects} {c.projects === 1 ? "Projekt" : "Projekte"} · DB {c.marginPct !== null ? <span className={marginTone(c.marginPct)}>{eur(c.margin)} ({pct(c.marginPct)})</span> : "–"}</p>
              </li>
            ))}
            {r.customers.length === 0 && <p className="text-sm text-steel">Noch keine Rechnungen in {year}.</p>}
          </ol>
        </section>

        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Package className="size-4 text-brand" /> Produkte</h2>
          <p className="text-xs text-steel">Produktgruppen nach Deckungsbeitrag (aus den Projekten)</p>
          <ol className="mt-3 space-y-3">
            {r.groups.map((g, i) => (
              <li key={g.name} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium"><span className="mr-1.5 text-steel">{i + 1}.</span>{g.name}</span>
                  <span className={clsx("shrink-0 font-semibold", marginTone(g.marginPct))}>{eur(g.margin)}</span>
                </div>
                <Bar value={g.margin} max={maxGroup} tone="bg-ok" />
                <p className="mt-0.5 text-xs text-steel">{g.projects} {g.projects === 1 ? "Projekt" : "Projekte"} · Auftragswert {eur(g.revenue)} · Marge {pct(g.marginPct)}{g.perHour !== null ? ` · ${eur(g.perHour)} DB je Stunde` : ""}</p>
              </li>
            ))}
            {r.groups.length === 0 && <p className="text-sm text-steel">Keine Projekte mit Nachkalkulation in {year}.</p>}
          </ol>
          {r.items.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Umsatzstärkste Positionen</h3>
              <ul className="mt-2 space-y-2">
                {r.items.slice(0, 6).map((x) => (
                  <li key={x.name} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2"><span className="truncate">{x.name}</span><span className="shrink-0">{eur(x.revenue)}</span></div>
                    <Bar value={x.revenue} max={maxItem} tone="bg-brand/60" />
                    <p className="text-xs text-steel">{x.group} · {x.count}× berechnet · {x.qty.toLocaleString("de-DE", { maximumFractionDigits: 1 })} {x.unit}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4 text-brand" /> Monteure & Werkstatt</h2>
        {!full ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-steel"><Lock className="size-4" /> Auswertung je Mitarbeiter sieht nur die Geschäftsführung.</p>
        ) : r.team.length === 0 ? (
          <p className="mt-2 text-sm text-steel">Keine Stunden in {year}.</p>
        ) : (
          <>
            <p className="text-xs text-steel">Deckungsbeitrag der Projekte anteilig nach gebuchten Stunden. Ist/Plan = tatsächliche gegen geplante Stunden der fertigen Fertigungskarten (unter 100 % = schneller als geplant).</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead><tr className="text-left text-xs text-steel"><th className="py-1 font-medium">Mitarbeiter</th><th className="font-medium">Stunden</th><th className="font-medium">auf Projekten</th><th className="w-40 font-medium">DB-Anteil</th><th className="font-medium">je Std.</th><th className="font-medium">Karten</th><th className="font-medium">Ist/Plan</th><th className="font-medium">Montagen</th></tr></thead>
                <tbody>
                  {r.team.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td>{Math.round(p.hours)}</td>
                      <td>{pct(p.productive)}</td>
                      <td className="pr-3"><span className={marginTone(p.margin)}>{eur(p.margin)}</span><Bar value={p.margin} max={maxTeam} tone="bg-ok" /></td>
                      <td>{p.perHour !== null ? eur(p.perHour) : "–"}</td>
                      <td>{p.jobsDone}</td>
                      <td className={clsx(p.planAccuracy !== null && p.planAccuracy > 110 && "text-warn")}>{pct(p.planAccuracy)}</td>
                      <td>{p.assemblies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-steel">Hinweis: Zahlen zeigen, wo Projekte gut laufen – nicht wie gut jemand arbeitet. Für Leistungsbewertungen nicht allein verwenden.</p>
          </>
        )}
      </section>
    </main>
  );
}
