import Link from "next/link";
import { clsx } from "clsx";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FileArchive, FileSpreadsheet, Info, Settings, TriangleAlert, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/user";
import { formatDate, todayYmd } from "@/lib/berlin";
import { MONTHS, isMonth } from "@/lib/buchhaltung/ablage";
import { datevPreview } from "@/lib/buchhaltung/datev-paket";
import { fmtEuroCents } from "@/lib/buchhaltung/money";

export const metadata = { title: "DATEV-Export" };
export const dynamic = "force-dynamic";

const ymd = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const euro = (n: number) => fmtEuroCents(Math.round(n * 100));

export default async function DatevPage({ searchParams }: { searchParams: Promise<{ monat?: string; von?: string; bis?: string; altbelege?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const today = todayYmd();
  // Standard: Vormonat – so gibt man es dem Steuerberater üblicherweise
  const month = isMonth(sp.monat) ? sp.monat : shift(today.slice(0, 7), -1);
  let von = ymd(sp.von) ?? `${month}-01`;
  let bis = ymd(sp.bis) ?? lastDay(month);
  if (von > bis) [von, bis] = [bis, von];
  const sameYear = von.slice(0, 4) === bis.slice(0, 4);
  const withImported = sp.altbelege === "1";
  const p = await datevPreview(von, bis, { withImported });
  const ready = !!(p.cfg.datevBerater && p.cfg.datevMandant);
  const year = Number(von.slice(0, 4));
  const q = `von=${von}&bis=${bis}${withImported ? "&altbelege=1" : ""}`;
  const missingFiles = p.purchasesWithoutFile.length + p.invoicesWithoutPdf;

  return (
    <main className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2"><FileArchive className="size-6 text-brand" /> DATEV-Export</h1>
        <p className="text-sm text-steel">Buchungen, Kunden und Belegbilder für den Steuerberater – im DATEV-Format, das er direkt einliest. Am besten jeden Monat einmal.</p>
      </div>

      <section className={clsx("card flex flex-wrap items-center gap-3 p-4 text-sm", !ready && "border-warn")}>
        {ready ? (
          <p className="flex items-center gap-1.5 text-ok"><CheckCircle2 className="size-4" /> Eingerichtet</p>
        ) : (
          <p className="flex items-center gap-1.5 text-warn"><TriangleAlert className="size-4" /> Berater- und Mandantennummer fehlen noch (bekommt ihr vom Steuerberater).</p>
        )}
        <span className="text-steel">Beraternr. <b className="text-ink">{p.cfg.datevBerater || "–"}</b> · Mandantennr. <b className="text-ink">{p.cfg.datevMandant || "–"}</b> · Kontenrahmen <b className="text-ink">SKR {p.cfg.datevSkr}</b> · Wirtschaftsjahr ab Monat <b className="text-ink">{p.cfg.datevWjMonth}</b></span>
        <Link href="/buchhaltung/einstellungen#datev" className="btn-secondary ml-auto"><Settings className="size-4" /> Ändern</Link>
      </section>

      <section className="card space-y-3 p-3">
        <div className="flex items-center justify-between">
          <Link href={`/buchhaltung/datev?monat=${year - 1}-12`} className="rounded-lg p-1 text-steel hover:bg-mist" aria-label="Vorjahr"><ChevronLeft className="size-5" /></Link>
          <span className="font-semibold">{year}</span>
          <Link href={`/buchhaltung/datev?monat=${year + 1}-01`} className={clsx("rounded-lg p-1 text-steel hover:bg-mist", `${year + 1}-01` > today.slice(0, 7) && "pointer-events-none opacity-30")} aria-label="Folgejahr"><ChevronRight className="size-5" /></Link>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
          {MONTHS.map((name, i) => {
            const m = `${year}-${String(i + 1).padStart(2, "0")}`;
            const on = von === `${m}-01` && bis === lastDay(m);
            return (
              <Link key={m} href={`/buchhaltung/datev?monat=${m}`} className={clsx("rounded-xl border px-2 py-1.5 text-center text-xs font-semibold transition", on ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand", m > today.slice(0, 7) && "pointer-events-none opacity-40")}>
                {name.slice(0, 3)}
              </Link>
            );
          })}
        </div>
        <form className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="text-xs text-steel">Von<input type="date" name="von" defaultValue={von} className="input mt-0.5" /></label>
          <label className="text-xs text-steel">Bis<input type="date" name="bis" defaultValue={bis} className="input mt-0.5" /></label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-steel"><input type="checkbox" name="altbelege" value="1" defaultChecked={withImported} /> Aus Lexware übernommene Altbelege mitnehmen</label>
          <button className="btn-secondary">Zeitraum anzeigen</button>
        </form>
        {!sameYear && <p className="text-sm text-bad">Ein DATEV-Stapel darf nur ein Kalenderjahr enthalten – bitte den Zeitraum teilen.</p>}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-steel">Buchungen</p><p className="text-2xl font-semibold tabular-nums">{p.rows}</p><p className="text-xs text-steel">{formatDate(new Date(`${von}T12:00:00`))} – {formatDate(new Date(`${bis}T12:00:00`))}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Ausgangsrechnungen</p><p className="text-2xl font-semibold tabular-nums">{euro(p.revenue)}</p><p className="text-xs text-steel">{p.invoices} Rechnungen{p.credits ? `, ${p.credits} Gutschriften` : ""} · {p.payments} Zahlungen</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Ausgaben</p><p className="text-2xl font-semibold tabular-nums">{euro(p.expenses)}</p><p className="text-xs text-steel">{p.purchases} Eingangsbelege{p.alreadyExported ? ` · ${p.alreadyExported} schon exportiert` : ""}</p></div>
        <div className={clsx("card p-4", missingFiles && "border-warn")}><p className="text-xs text-steel">Belegbilder</p><p className={clsx("text-2xl font-semibold tabular-nums", missingFiles ? "text-warn" : "text-ok")}>{missingFiles ? `${missingFiles} fehlen` : "vollständig"}</p><p className="text-xs text-steel">{p.invoices + p.credits - p.invoicesWithoutPdf + p.purchases - p.purchasesWithoutFile.length} kommen ins Paket</p></div>
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <a href={`/api/buchhaltung/datev?art=paket&${q}`} className={clsx("btn-primary", (!ready || !sameYear) && "pointer-events-none opacity-50")}><Download className="size-4" /> DATEV-Paket (ZIP)</a>
          <a href={`/api/buchhaltung/datev?art=stapel&${q}`} className={clsx("btn-secondary", (!ready || !sameYear) && "pointer-events-none opacity-50")}><FileSpreadsheet className="size-4" /> Nur Buchungsstapel (CSV)</a>
          <a href={`/api/buchhaltung/datev?art=stammdaten&${q}`} className={clsx("btn-secondary", (!ready || !sameYear) && "pointer-events-none opacity-50")}><Users className="size-4" /> Kunden-Stammdaten (CSV)</a>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-steel">
          <li><b className="text-ink">Paket</b>: Buchungsstapel (EXTF 700) + Debitoren-Stammdaten + Belegbilder je Rechnungsausgang/-eingang als ZIP mit <code>document.xml</code> + Lies-mich. Das schickt ihr dem Steuerberater.</li>
          <li>Kunden mit Kundennummer 10000–69999 bekommen ihr eigenes Debitorenkonto ({p.customers} Kunden){p.unknownDebitor ? `, ${p.unknownDebitor} andere laufen über den Sammeldebitor 10000` : ""}. Ausgaben laufen über den Sammelkreditor 70000.</li>
          {!withImported && p.skipped > 0 && <li>{p.skipped} aus Lexware übernommene Altbelege in diesem Zeitraum sind nicht dabei – die hat der Steuerberater schon aus Lexware.</li>}
          <li>Ausgaben werden beim Export als „exportiert“ markiert und lassen sich danach nicht mehr löschen.</li>
        </ul>
      </section>

      {missingFiles > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-warn"><TriangleAlert className="size-4" /> Ohne Belegbild</h2>
          <ul className="space-y-1">
            {p.purchasesWithoutFile.slice(0, 10).map((x) => (
              <li key={x.id}><Link href={`/buchhaltung/ausgaben/${x.id}`} className="text-brand">{x.number} · {x.supplier}</Link> <span className="text-steel">{fmtEuroCents(x.grossCents)} – Foto oder PDF nachreichen</span></li>
            ))}
            {p.invoicesWithoutPdf > 0 && <li className="text-steel">{p.invoicesWithoutPdf} Ausgangsrechnung(en) ohne archiviertes PDF</li>}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="border-b border-line p-4 font-semibold">Vorschau Buchungsstapel <span className="text-sm font-normal text-steel">{p.rows > p.sample.length ? `(erste ${p.sample.length} von ${p.rows})` : ""}</span></h2>
        {p.rows === 0 ? (
          <p className="p-4 text-sm text-steel">Keine Buchungen in diesem Zeitraum.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-steel">
              <tr><th className="px-4 py-2">Datum</th><th className="px-2">Beleg</th><th className="px-2 text-right">Umsatz</th><th className="px-2">S/H</th><th className="px-2">Konto</th><th className="px-2">Gegenkonto</th><th className="px-2">BU</th><th className="px-2">Buchungstext</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.sample.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-4 py-1.5 tabular-nums">{formatDate(r.date)}</td>
                  <td className="whitespace-nowrap px-2 font-medium">{r.beleg}</td>
                  <td className="px-2 text-right tabular-nums">{euro(r.amount)}</td>
                  <td className="px-2">{r.sh}</td>
                  <td className="px-2 tabular-nums">{r.konto}</td>
                  <td className="px-2 tabular-nums">{r.gegen}</td>
                  <td className="px-2">{r.bu}</td>
                  <td className="px-2 text-steel">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="flex items-center gap-2 font-semibold"><Info className="size-4 text-brand" /> So kommt es zum Steuerberater</h2>
        <ol className="list-decimal space-y-1 pl-5 text-steel">
          <li><b className="text-ink">Paket schicken</b> (Mail, Cloud, USB). Der Steuerberater liest den Buchungsstapel in DATEV Rechnungswesen ein (Stapelverarbeitung → ASCII-Import) und die Kunden als Stammdaten.</li>
          <li><b className="text-ink">Belege über DATEV Unternehmen online</b>: Wenn ihr DATEV Unternehmen online nutzt, ladet die beiden Beleg-ZIPs unverändert per Belegtransfer bzw. Upload in „Rechnungsausgang“ und „Rechnungseingang“ hoch. Die Dateinamen sind die Belegnummern aus dem Stapel.</li>
          <li><b className="text-ink">Direkte Übertragung</b> (ohne Datei, über die DATEV-Schnittstelle) braucht eine Freischaltung als DATEV-Partner und die Zustimmung des Steuerberaters – das bauen wir bei Bedarf nach.</li>
        </ol>
        <p className="text-xs text-steel">Beim ersten Mal den Steuerberater einmal die Kontenzuordnung (Erlöse, Aufwand je Kategorie, § 13b) prüfen lassen.</p>
      </section>
    </main>
  );
}
