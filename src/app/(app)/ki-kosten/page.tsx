import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { requireAdmin } from "@/lib/auth/user";
import { formatEuro } from "@/lib/berlin";
import { kiReport, microToEur, type KiConfig, type KiRow } from "@/lib/ki-kosten";
import { monthLabel, monthRange, thisMonth } from "@/lib/zeiten";
import { KiSettings } from "./settings";
import { KiModelSettings } from "./modell";
import { kiModelConfig } from "@/lib/ki-modell";
import { modelInfo } from "@/lib/ki-modell-shared";

export const metadata = { title: "KI-Kosten" };
export const dynamic = "force-dynamic";

/** Tokens kurz: 950 · 12,4 Tsd. · 3,1 Mio. */
function tok(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Mio.`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("de-DE")} Tsd.`;
  return n.toLocaleString("de-DE");
}
/** Kleine Beträge mit Cent-Bruchteilen, damit 0,003 € nicht als 0,00 € erscheint */
function eur(v: number) {
  if (v > 0 && v < 0.1) return `${v.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`;
  return formatEuro(v);
}

function Breakdown({ title, rows, cfg, total, showTokens = false }: { title: string; rows: KiRow[]; cfg: KiConfig; total: number; showTokens?: boolean }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-steel">Keine Aufrufe in diesem Monat.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => {
            const share = total > 0 ? r.micro / total : 0;
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{r.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{eur(microToEur(r.micro, cfg))}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-soft">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(share * 100, r.micro > 0 ? 1 : 0)}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-steel tabular-nums">
                  {r.n.toLocaleString("de-DE")} {r.n === 1 ? "Aufruf" : "Aufrufe"} · {Math.round(share * 100)} %
                  {showTokens && ` · Eingabe ${tok(r.input - r.cacheRead - r.cacheWrite)} · aus Cache ${tok(r.cacheRead)} · Ausgabe ${tok(r.output)}${r.web ? ` · ${r.web} Websuchen` : ""}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function KiKostenPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const now = thisMonth();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat ?? "") && sp.monat! <= now ? sp.monat! : now;
  const { prev, next } = monthRange(month);
  const [r, modelCfg] = await Promise.all([kiReport(month), kiModelConfig()]);
  const cheapest = microToEur(r.cheapestMicro, r.cfg);
  const cfg = r.cfg;
  const total = microToEur(r.sum.micro, cfg);
  const forecast = r.forecastMicro !== null ? microToEur(r.forecastMicro, cfg) : null;
  const budget = cfg.budgetEur;
  const used = budget ? total / budget : 0;
  const pastDays = r.days.filter((d) => !d.future);
  const avg = pastDays.length ? total / pastDays.length : 0;
  const maxDay = Math.max(...r.days.map((d) => d.micro), 1);
  const maxMonth = Math.max(...r.months.map((m) => m.micro), 1);
  const cacheShare = r.sum.input > 0 ? r.sum.cacheRead / r.sum.input : 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">KI-Kosten</h1>
          <p className="mt-1 text-sm text-steel">Was Jarvis und die KI-Funktionen bei Anthropic (Claude) verbrauchen – je Tag, Funktion und Mitarbeiter.</p>
        </div>
        <nav className="flex items-center gap-1" aria-label="Monat wählen">
          <Link href={`/ki-kosten?monat=${prev}`} className="btn-secondary !px-2.5" aria-label="Vormonat"><ChevronLeft size={16} /></Link>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
          {month < now ? (
            <Link href={`/ki-kosten?monat=${next}`} className="btn-secondary !px-2.5" aria-label="Nächster Monat"><ChevronRight size={16} /></Link>
          ) : (
            <span className="btn-secondary pointer-events-none !px-2.5 opacity-40" aria-hidden><ChevronRight size={16} /></span>
          )}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-steel">Kosten {r.current ? "bisher" : "im Monat"}</p>
          <p className="text-2xl font-semibold tabular-nums">{eur(total)}</p>
          <p className="text-xs text-steel">≈ {(r.sum.micro / 10_000).toLocaleString("de-DE", { style: "currency", currency: "USD" })}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-steel">{r.current ? "Heute" : "Ø je Tag"}</p>
          <p className="text-2xl font-semibold tabular-nums">{eur(r.today !== null ? microToEur(r.today, cfg) : avg)}</p>
          <p className="text-xs text-steel">{r.current ? `Ø ${eur(avg)} je Tag` : `${pastDays.length} Tage`}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-steel">{forecast !== null ? "Hochrechnung Monatsende" : budget ? "Budget" : "Aufrufe"}</p>
          <p className="text-2xl font-semibold tabular-nums">{forecast !== null ? eur(forecast) : budget ? formatEuro(budget) : r.sum.n.toLocaleString("de-DE")}</p>
          {budget ? (
            <>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-soft" title={`${Math.round(used * 100)} % des Budgets`}>
                <div className={`h-full rounded-full ${used >= 1 ? "bg-bad" : used >= 0.8 ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.min(used, 1) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-steel">{Math.round(used * 100)} % von {formatEuro(budget)} Budget</p>
            </>
          ) : (
            <p className="text-xs text-steel">{forecast !== null ? "bei gleichem Verbrauch" : "Claude-Aufrufe"}</p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-steel">Tokens</p>
          <p className="text-2xl font-semibold tabular-nums">{tok(r.sum.input + r.sum.output)}</p>
          <p className="text-xs text-steel">{r.sum.n.toLocaleString("de-DE")} Aufrufe · {Math.round(cacheShare * 100)} % aus Cache</p>
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Kosten je Tag</h2>
          <span className="text-xs text-steel">höchster Tag {eur(microToEur(maxDay === 1 ? 0 : maxDay, cfg))}</span>
        </div>
        <div className="mt-4 flex h-40 items-end gap-[2px] sm:gap-1" role="img" aria-label={`Kosten je Tag im ${monthLabel(month)}`}>
          {r.days.map((d) => (
            <div key={d.ymd} className="group relative flex h-full flex-1 items-end" title={`${d.ymd.slice(8)}.${d.ymd.slice(5, 7)}.: ${eur(microToEur(d.micro, cfg))} · ${d.n} Aufrufe · ${tok(d.tokens)} Tokens`}>
              <div className={`w-full rounded-t-[3px] ${d.future ? "bg-transparent" : d.micro > 0 ? "bg-brand group-hover:bg-brand-2" : "bg-brand-soft"}`} style={{ height: d.micro > 0 ? `${Math.max((d.micro / maxDay) * 100, 2)}%` : "2px" }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[2px] text-[10px] text-steel sm:gap-1">
          {r.days.map((d, i) => (
            <span key={d.ymd} className="flex-1 text-center tabular-nums">{i === 0 || (i + 1) % 5 === 0 ? i + 1 : ""}</span>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="Nach Funktion" rows={r.byFeature} cfg={cfg} total={r.sum.micro} />
        <Breakdown title="Nach Mitarbeiter" rows={r.byUser} cfg={cfg} total={r.sum.micro} />
      </div>

      <Breakdown title="Nach KI-Modell" rows={r.byModel} cfg={cfg} total={r.sum.micro} showTokens />

      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold">Letzte 12 Monate</h2>
        <div className="mt-4 flex h-32 items-end gap-1.5 sm:gap-3">
          {r.months.map((m) => (
            <Link key={m.month} href={`/ki-kosten?monat=${m.month}`} className="group flex h-full flex-1 flex-col items-center justify-end" title={`${monthLabel(m.month)}: ${eur(microToEur(m.micro, cfg))} · ${m.n} Aufrufe`}>
              <span className="mb-1 hidden text-[10px] text-steel tabular-nums sm:block">{m.micro > 0 ? Math.round(microToEur(m.micro, cfg)).toLocaleString("de-DE") : ""}</span>
              <div className={`w-full rounded-t ${m.month === month ? "bg-brand" : "bg-brand/35 group-hover:bg-brand/60"}`} style={{ height: m.micro > 0 ? `${Math.max((m.micro / maxMonth) * 100, 3)}%` : "2px" }} />
            </Link>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5 text-[10px] text-steel sm:gap-3">
          {r.months.map((m) => (
            <span key={m.month} className="flex-1 text-center">{new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-15T00:00:00Z`)).replace(".", "")}</span>
          ))}
        </div>
      </section>

      <section id="modell" className="card space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">KI-Modell</h2>
          <span className="text-xs text-steel">Standard: {modelInfo(modelCfg.standard)?.label}</span>
        </div>
        {r.sum.n > 0 && total - cheapest > 0.01 && (
          <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
            Mit dem günstigsten Modell (Haiku 5.5) hätte {r.current ? "dieser Monat bisher" : "dieser Monat"} ca. <b>{eur(cheapest)}</b> statt {eur(total)} gekostet.
          </p>
        )}
        <KiModelSettings cfg={modelCfg} />
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">Einstellungen</h2>
        <KiSettings cfg={cfg} />
      </section>

      <p className="flex gap-2 text-xs text-steel">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          Geschätzt aus den Listenpreisen von Anthropic (in US-Dollar, umgerechnet mit dem Kurs oben) und den Token-Zahlen, die Claude bei jedem Aufruf meldet. Maßgeblich ist die Rechnung in der Anthropic-Console. Aufrufe vor dem Einbau dieser Seite sind ohne Mitarbeiter erfasst; Hintergrund-Aufgaben (z. B. Belege auslesen nach dem Hochladen) stehen unter „Ohne Nutzer“.
        </span>
      </p>
    </main>
  );
}
