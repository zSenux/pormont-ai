import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate, todayYmd } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { bookConfig, fmtIban } from "@/lib/buchhaltung/config";
import { computeTotals, fmtEuroCents, fmtNum, fmtPrice, lineNetCents, readLines } from "@/lib/buchhaltung/money";
import { PrintButton } from "@/components/print-button";

// Auftragsbestätigung und Lieferschein zum Auftrag (Druck/PDF über den Browser).
// Positionen kommen aus dem Angebot des Auftrags; ohne Angebot steht die Auftragsbezeichnung als Pauschale.
// Kein Buchungsbeleg (GoBD betrifft nur Rechnungen/Gutschriften) – wird jedes Mal frisch aus den Daten erzeugt.

export async function OrderDoc({ id, kind }: { id: string; kind: "bestaetigung" | "lieferschein" }) {
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: true,
      quote: { select: { number: true, date: true, lines: true, reverseCharge: true, title: true } },
      project: { select: { name: true, address: true } },
    },
  });
  if (!o) notFound();
  const config = kind === "bestaetigung" ? await bookConfig() : null;
  const lines = readLines(o.quote?.lines);
  const fallback = lines.length === 0;
  const totals = fallback ? null : computeTotals(lines, o.quote?.reverseCharge);
  const net = totals?.netCents ?? o.valueCents;
  const tax = totals ? totals.taxCents : o.quote?.reverseCharge ? 0 : Math.round(net * 0.19);
  const c = o.customer;
  const today = formatDate(new Date(`${todayYmd()}T12:00:00`));
  const ab = kind === "bestaetigung";
  const title = ab ? "Auftragsbestätigung" : "Lieferschein";
  const docNo = ab ? o.number : o.number.replace(/^AU-/, "LS-");

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/auftraege/${o.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Zum Auftrag</Link>
        <div className="flex gap-2">
          <Link href={`/auftraege/${o.id}/${ab ? "lieferschein" : "bestaetigung"}`} className="btn-secondary">{ab ? "Lieferschein" : "Auftragsbestätigung"}</Link>
          <PrintButton label="Drucken / als PDF" />
        </div>
      </div>

      <article className="keep-light card space-y-6 p-6 md:p-10 print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div className="text-sm">
            <p className="mb-3 text-[10px] text-steel underline">{COMPANY.name} · {COMPANY.street} · {COMPANY.zip} {COMPANY.city}</p>
            {c ? (
              <>
                <p className="font-medium">{c.name}</p>
                {c.contactName && c.kind === "FIRMA" && <p>{c.contactName}</p>}
                {c.street && <p>{c.street}</p>}
                {(c.zip || c.city) && <p>{[c.zip, c.city].filter(Boolean).join(" ")}</p>}
              </>
            ) : (
              <p className="font-medium">{o.project.name}</p>
            )}
          </div>
          <div className="shrink-0 text-right text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt={COMPANY.name} className="ml-auto h-10 w-auto" />
            <p className="mb-3 mt-1 text-[10px] text-steel">{COMPANY.subtitle}</p>
            <dl className="grid grid-cols-[auto_auto] justify-end gap-x-3 text-xs">
              <dt className="text-steel">{ab ? "Auftrag" : "Lieferschein"}</dt><dd className="font-semibold">{docNo}</dd>
              <dt className="text-steel">Datum</dt><dd>{today}</dd>
              {c?.number && <><dt className="text-steel">Kunden-Nr.</dt><dd>{c.number}</dd></>}
              {o.customerRef && <><dt className="text-steel">Ihr Zeichen</dt><dd>{o.customerRef}</dd></>}
              {o.quote?.number && <><dt className="text-steel">Angebot</dt><dd>{o.quote.number} vom {formatDate(o.quote.date)}</dd></>}
            </dl>
          </div>
        </header>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title} {docNo}</h1>
          <p className="text-sm text-steel">{o.title}{o.project.address && ` · ${ab ? "Ausführungsort" : "Lieferadresse"}: ${o.project.address}`}</p>
        </div>

        <p className="text-sm">
          {c?.kind === "PERSON" && c.lastName ? `Guten Tag ${[c.salutation, c.lastName].filter(Boolean).join(" ")},` : "Sehr geehrte Damen und Herren,"}
          <br />
          {ab
            ? `vielen Dank für Ihren Auftrag${o.quote?.number ? ` auf Grundlage unseres Angebots ${o.quote.number}` : ""}. Wir bestätigen Ihnen die Ausführung der folgenden Leistungen:`
            : "wir liefern Ihnen folgende Leistungen bzw. Teile. Bitte prüfen Sie die Lieferung auf Vollständigkeit und bestätigen Sie den Empfang mit Ihrer Unterschrift."}
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-left text-xs text-steel">
              <th className="w-10 py-2 pr-2">Pos.</th>
              <th className="py-2 pr-2">Bezeichnung</th>
              <th className="py-2 pr-2 text-right">Menge</th>
              {ab && <th className="py-2 pr-2 text-right">Einzelpreis</th>}
              {ab && <th className="py-2 text-right">Gesamt netto</th>}
              {!ab && <th className="w-20 py-2 text-center">geliefert</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {fallback ? (
              <tr className="align-top">
                <td className="py-2 pr-2">1</td>
                <td className="py-2 pr-2"><p className="font-medium">{o.title}</p>{o.production && <p className="whitespace-pre-line text-xs text-steel">{o.production}</p>}</td>
                <td className="py-2 pr-2 text-right">1 pauschal</td>
                {ab && <td className="py-2 pr-2 text-right">{fmtEuroCents(o.valueCents)}</td>}
                {ab && <td className="py-2 text-right font-medium">{fmtEuroCents(o.valueCents)}</td>}
                {!ab && <td className="py-2 text-center text-lg">☐</td>}
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="py-2 pr-2">{i + 1}</td>
                  <td className="py-2 pr-2"><p className="font-medium">{l.name}</p>{l.description && <p className="whitespace-pre-line text-xs text-steel">{l.description}</p>}</td>
                  <td className="py-2 pr-2 text-right whitespace-nowrap">{fmtNum(l.qty)} {l.unit}</td>
                  {ab && <td className="py-2 pr-2 text-right whitespace-nowrap">{fmtPrice(l.price)}{l.discount ? <span className="block text-xs text-steel">− {fmtNum(l.discount)} %</span> : null}</td>}
                  {ab && <td className="py-2 text-right font-medium whitespace-nowrap">{fmtEuroCents(lineNetCents(l))}</td>}
                  {!ab && <td className="py-2 text-center text-lg">☐</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {ab && (
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <p className="flex justify-between"><span>Summe netto</span><span>{fmtEuroCents(net)}</span></p>
            {o.quote?.reverseCharge ? (
              <p className="text-xs text-steel">Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)</p>
            ) : totals ? (
              totals.taxes.map((t) => <p key={t.rate} className="flex justify-between"><span>zzgl. {t.rate} % USt.</span><span>{fmtEuroCents(t.taxCents)}</span></p>)
            ) : (
              <p className="flex justify-between"><span>zzgl. 19 % USt.</span><span>{fmtEuroCents(tax)}</span></p>
            )}
            <p className="flex justify-between border-t-2 border-ink pt-1 text-base font-bold"><span>Auftragssumme</span><span>{fmtEuroCents(net + tax)}</span></p>
          </div>
        )}

        <section className="grid gap-3 text-sm sm:grid-cols-2">
          {(o.startDate || o.dueDate) && (
            <div><p className="text-xs text-steel">{ab ? "Ausführungszeitraum" : "Ausführung"}</p><p className="font-medium">{o.startDate ? formatDate(o.startDate) : "nach Absprache"} – {o.dueDate ? formatDate(o.dueDate) : "nach Absprache"}</p></div>
          )}
          {ab && config && <div><p className="text-xs text-steel">Zahlung</p><p className="font-medium">{config.paymentDays ? `${config.paymentDays} Tage nach Rechnungsstellung ohne Abzug` : "sofort nach Rechnungsstellung"}</p></div>}
        </section>

        {ab ? (
          <p className="text-sm">Sollte etwas von Ihrer Bestellung abweichen, geben Sie uns bitte innerhalb von 5 Werktagen Bescheid. Wir freuen uns auf die Zusammenarbeit.<br /><br />Mit freundlichen Grüßen<br />{COMPANY.name}</p>
        ) : (
          <section className="grid gap-8 pt-10 sm:grid-cols-2 print:break-inside-avoid">
            <p className="border-t border-ink pt-1 text-sm">Ware vollständig und ohne sichtbare Mängel erhalten<br /><span className="text-xs text-steel">Ort, Datum, Unterschrift Empfänger</span></p>
            <p className="border-t border-ink pt-1 text-sm">{COMPANY.name}<br /><span className="text-xs text-steel">Unterschrift Fahrer/Monteur</span></p>
          </section>
        )}

        <footer className="grid gap-2 border-t border-line pt-3 text-[10px] text-steel sm:grid-cols-4">
          <p>{COMPANY.name}<br />{COMPANY.street}<br />{COMPANY.zip} {COMPANY.city}</p>
          <p>{config?.iban ? <>{config.bankName || "Bankverbindung"}<br />IBAN {fmtIban(config.iban)}{config.bic && <><br />BIC {config.bic}</>}</> : "Bankverbindung"}</p>
          <p>{COMPANY.register}<br />USt-IdNr. {COMPANY.vatId}</p>
          <p>Tel. {COMPANY.phone}<br />Mobil {COMPANY.mobile}<br />{COMPANY.email}<br />{COMPANY.web}</p>
        </footer>
      </article>
    </main>
  );
}
