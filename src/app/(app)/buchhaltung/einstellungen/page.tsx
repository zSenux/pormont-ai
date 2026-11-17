import { CheckCircle2, Download, FileImage, Hash, Landmark, Loader2, Upload } from "lucide-react";
import { requireAdmin } from "@/lib/auth/user";
import { berlinParts, formatDateTime, todayYmd } from "@/lib/berlin";
import { lexwareConfigured } from "@/lib/lexware/client";
import { bookConfig, fmtIban, missingForInvoices } from "@/lib/buchhaltung/config";
import { COMPANY } from "@/lib/company";
import { numberState } from "@/lib/buchhaltung/docs";
import { importState } from "@/lib/buchhaltung/lexware-import";
import { ConfigForm, ImportForm, LetterheadForm, NumberForm, NumberFormatForm } from "./forms";

export const metadata = { title: "Buchhaltung – Einstellungen" };
export const dynamic = "force-dynamic";

export default async function BookSettings() {
  await requireAdmin();
  const year = berlinParts().y;
  const [cfg, imp] = await Promise.all([bookConfig(), importState()]);
  const nums = await numberState(year, cfg.numberFormat);
  const lex = cfg.numberFormat === "lexware";
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
        <div className="rounded-lg bg-brand/5 p-3 text-xs text-steel">
          <p className="mb-1 font-semibold text-ink">Stammdaten auf jedem Beleg (wie auf dem Briefpapier)</p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
            <p>{COMPANY.name}<br />{COMPANY.street}<br />{COMPANY.zip} {COMPANY.city}</p>
            <p>{COMPANY.bank.name}<br />IBAN {fmtIban(COMPANY.bank.iban)}<br />BIC {COMPANY.bank.bic}</p>
            <p>{COMPANY.register}<br />USt-IdNr. {COMPANY.vatId}</p>
            <p>Tel. {COMPANY.phone}<br />Mobil {COMPANY.mobile}<br />{COMPANY.email} · {COMPANY.web}</p>
          </div>
          <p className="mt-2">{COMPANY.subtitle}. Die Bankverbindung oben hat Vorrang; ist das Feld IBAN leer, gilt die Deutsche Bank von ProMont.</p>
        </div>
      </section>

      <section id="briefpapier" className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><FileImage className="size-4 text-brand" /> Eigenes Briefpapier</h2>
        <p className="text-sm text-steel">Euer Briefkopf mit Fußzeile liegt dann hinter jedem Angebot, jeder Rechnung, Gutschrift, Mahnung und Auftragsbestätigung – überall gleich. Schon festgeschriebene Belege behalten ihr archiviertes PDF.</p>
        <LetterheadForm c={cfg} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Hash className="size-4 text-brand" /> Nummernkreise</h2>
        <NumberFormatForm format={cfg.numberFormat} />
        <p className="text-sm text-steel">
          Nummern werden beim Festschreiben fortlaufend vergeben und nie doppelt.{" "}
          {nums.mode === "next"
            ? <>Nächste Nummer: Rechnung <strong className="text-ink">{nums.RECHNUNG}</strong>, Angebot <strong className="text-ink">{nums.ANGEBOT}</strong>, Gutschrift/Storno <strong className="text-ink">{nums.GUTSCHRIFT}</strong>. Lädst du später noch Belege aus Lexware hoch, zählt Jarvis automatisch hinter der höchsten Nummer weiter.</>
            : <>Zuletzt vergeben {year}: Rechnungen {nums.RECHNUNG}, Angebote {nums.ANGEBOT}, Gutschriften {nums.GUTSCHRIFT}.</>}
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">Mit einer höheren Nummer weitermachen</summary>
          <div className="mt-2"><NumberForm year={year} lexware={lex} /></div>
          <p className="mt-1 text-xs text-steel">Geht nur nach oben – bereits vergebene Nummern bleiben gesperrt.{lex ? " Zum Beispiel, wenn die Angebote in Lexware einen eigenen Nummernkreis hatten." : ""}</p>
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
          <button formAction="/api/buchhaltung/datev" className="btn-secondary"><Download className="size-4" /> Nur DATEV-Buchungsstapel</button>
          <a href="/buchhaltung/datev" className="btn-primary"><Download className="size-4" /> DATEV-Export mit Belegen →</a>
        </form>
        <p className="text-xs text-steel">CSV: alle festgeschriebenen Rechnungen und Gutschriften mit Netto, USt. und Zahlungsstand – öffnet sich in Excel.</p>
        <p className="text-xs text-steel">DATEV: Buchungsstapel (EXTF) mit Rechnungen, Zahlungseingängen, Ausgaben und deren Bezahlung – der Steuerberater liest die Datei direkt in DATEV ein. Ein Stapel je Kalenderjahr, am besten monatlich. {cfg.datevBerater && cfg.datevMandant ? `Berater ${cfg.datevBerater}, Mandant ${cfg.datevMandant}, SKR ${cfg.datevSkr}.` : "Vorher oben Berater- und Mandantennummer eintragen."} Das komplette Paket mit Kunden-Stammdaten und Belegbildern gibt es unter DATEV-Export.</p>
      </section>
    </main>
  );
}
