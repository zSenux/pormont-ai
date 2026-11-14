import { CheckCircle2, Download, Hash, Landmark, Loader2, Upload } from "lucide-react";
import { requireAdmin } from "@/lib/auth/user";
import { berlinParts, formatDateTime, todayYmd } from "@/lib/berlin";
import { lexwareConfigured } from "@/lib/lexware/client";
import { bookConfig, missingForInvoices } from "@/lib/buchhaltung/config";
import { numberState, PREFIX } from "@/lib/buchhaltung/docs";
import { importState } from "@/lib/buchhaltung/lexware-import";
import { ConfigForm, ImportForm, NumberForm } from "./forms";

export const metadata = { title: "Buchhaltung – Einstellungen" };
export const dynamic = "force-dynamic";

export default async function BookSettings() {
  await requireAdmin();
  const year = berlinParts().y;
  const [cfg, nums, imp] = await Promise.all([bookConfig(), numberState(year), importState()]);
  const missing = missingForInvoices(cfg);
  const running = imp?.status === "laeuft";
  const today = todayYmd();
  return (
    <main className="space-y-5">
      <h1 className="page-title">Einstellungen Buchhaltung</h1>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Landmark className="size-4 text-brand" /> Firmendaten für Belege</h2>
        {missing.length > 0 ? <p className="text-sm text-warn">Für Rechnungen fehlt noch: {missing.join(", ")}.</p> : <p className="flex items-center gap-1 text-sm text-ok"><CheckCircle2 className="size-4" /> Alles da für Rechnungen und E-Rechnung.</p>}
        <ConfigForm c={cfg} />
        <p className="text-xs text-steel">Name, Anschrift, USt-IdNr., Handelsregister und Geschäftsführung kommen aus den ProMont-Stammdaten und stehen automatisch auf jedem Beleg.</p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Hash className="size-4 text-brand" /> Nummernkreise {year}</h2>
        <p className="text-sm text-steel">Nummern werden beim Festschreiben fortlaufend vergeben (z. B. {PREFIX.RECHNUNG}-{year}-0001) und nie doppelt. Zuletzt vergeben: Rechnungen {nums.RECHNUNG || "–"}, Angebote {nums.ANGEBOT || "–"}, Gutschriften {nums.GUTSCHRIFT || "–"}.</p>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">Mit einer höheren Nummer weitermachen (z. B. nach Lexware)</summary>
          <div className="mt-2"><NumberForm year={year} /></div>
          <p className="mt-1 text-xs text-steel">Geht nur nach oben – bereits vergebene Nummern bleiben gesperrt.</p>
        </details>
      </section>

      <section id="lexware" className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Upload className="size-4 text-brand" /> Umzug aus Lexware</h2>
        <p className="text-sm text-steel">Übernimmt Kunden (mit Kundennummer), Artikel, alle offenen Rechnungen mit Original-PDF und Zahlungsstand sowie offene Angebote. Mehrmals ausführen ist sicher: Schon Übernommenes wird nicht doppelt angelegt, und Zahlungen offener Rechnungen werden abgeglichen.</p>
        {!lexwareConfigured() ? (
          <p className="text-sm text-warn">Dafür muss der Lexware-Schlüssel noch unter Einstellungen → Verbindungen stehen.</p>
        ) : (
          <ImportForm running={running} />
        )}
        {imp && (
          <div className="rounded-2xl border border-line bg-mist/50 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">{running && <Loader2 className="size-4 animate-spin" />}{running ? `Läuft: ${imp.step} …` : imp.status === "fertig" ? "Letzte Übernahme fertig" : "Letzte Übernahme abgebrochen"} <span className="font-normal text-steel">({formatDateTime(imp.startedAt)}, {imp.by})</span></p>
            <p className="mt-1">Kunden {imp.kunden} · Artikel {imp.artikel} · Rechnungen/Gutschriften {imp.rechnungen} · Angebote {imp.angebote}{imp.abgeglichen ? ` · abgeglichen ${imp.abgeglichen}` : ""}</p>
            {imp.fehler.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-bad">{imp.fehler.slice(0, 15).map((f, i) => <li key={i}>{f}</li>)}</ul>}
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Download className="size-4 text-brand" /> Für den Steuerberater</h2>
        <form action="/api/buchhaltung/export" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-steel">Von<input type="date" name="von" defaultValue={`${today.slice(0, 7)}-01`} className="input mt-0.5" /></label>
          <label className="text-xs text-steel">Bis<input type="date" name="bis" defaultValue={today} className="input mt-0.5" /></label>
          <button className="btn-secondary"><Download className="size-4" /> Rechnungsausgangsbuch (CSV)</button>
          <button formAction="/api/buchhaltung/datev" className="btn-primary"><Download className="size-4" /> DATEV-Export</button>
        </form>
        <p className="text-xs text-steel">CSV: alle festgeschriebenen Rechnungen und Gutschriften mit Netto, USt. und Zahlungsstand – öffnet sich in Excel.</p>
        <p className="text-xs text-steel">DATEV: Buchungsstapel (EXTF) mit Rechnungen, Zahlungseingängen, Ausgaben und deren Bezahlung – der Steuerberater liest die Datei direkt in DATEV ein. Ein Stapel je Kalenderjahr, am besten monatlich. {cfg.datevBerater && cfg.datevMandant ? `Berater ${cfg.datevBerater}, Mandant ${cfg.datevMandant}, SKR ${cfg.datevSkr}.` : "Vorher oben Berater- und Mandantennummer eintragen."} Belegbilder (Fotos/PDFs) gibt es zusätzlich unter Ausgaben.</p>
      </section>
    </main>
  );
}
