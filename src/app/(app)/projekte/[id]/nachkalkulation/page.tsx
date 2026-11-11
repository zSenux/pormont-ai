import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calculator, Clock, Package, Receipt, Trash2, Truck, Wrench } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatEuro, todayYmd } from "@/lib/berlin";
import { formatHours } from "@/lib/hours";
import { lexwareConfigured } from "@/lib/lexware/client";
import { voucherList, voucherLink } from "@/lib/lexware/api";
import { calcProject, COST_LABEL, defaultHourlyRate } from "@/lib/nachkalkulation";
import { addProjectCost, deleteProjectCost, linkQuotation, saveCalcBasics } from "@/app/actions/lager";
import { ActionButton } from "@/components/confirm-button";
import { StateForm } from "@/components/state-form";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nachkalkulation" };

async function quotations(contactId: string | null) {
  if (!lexwareConfigured()) return null;
  try {
    const r = await voucherList({ type: "quotation", status: "open,accepted", contactId: contactId ?? undefined, size: 40 });
    return r.content.map((v) => ({ id: v.id, label: `${v.voucherNumber ?? "Entwurf"} · ${v.contactName ?? "?"} · ${formatDate(v.voucherDate)} · ${formatEuro(v.totalAmount)} brutto` }));
  } catch {
    return null;
  }
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const de = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

export default async function NachkalkulationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const c = await calcProject(id.data).catch(() => null);
  if (!c) notFound();
  const p = c.project;
  const quotes = await quotations(p.lexContactId);
  const lexLink = p.lexQuotationId ? voucherLink("quotation", p.lexQuotationId) : null;
  const rows = [
    { icon: Clock, label: "Lohn", detail: `${formatHours(c.minutes)} × ${formatEuro(c.rate)}`, amount: c.labor },
    { icon: Package, label: "Material aus Lager", detail: n(c.materialLines.length, "Entnahme", "Entnahmen"), amount: c.material },
    { icon: Truck, label: "Bestellt bei Lieferanten", detail: n(c.orders.length, "Angebot", "Angebote"), amount: c.supplier },
    { icon: Receipt, label: "Spesen", detail: n(c.expenseCount, "Eintrag", "Einträge"), amount: c.spesen },
    { icon: Wrench, label: "Sonstige Kosten", detail: n(c.costs.length, "Posten", "Posten"), amount: c.extra },
  ];
  const tone = c.marginPct === null ? "text-ink" : c.marginPct < 0 ? "text-bad" : c.marginPct < 15 ? "text-warn" : "text-ok";

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href={`/projekte/${p.id}`} className="flex items-center gap-1 text-sm text-steel hover:text-brand print:hidden"><ArrowLeft className="size-4" /> {p.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Nachkalkulation</h1>
          <p className="mt-1 text-sm text-steel">{p.name}{p.customer ? ` · ${p.customer}` : ""} · alle Beträge netto · Stand {formatDate(new Date())}</p>
        </div>
        <div className="print:hidden"><PrintButton /></div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-steel">Auftragswert</p><p className="text-xl sm:text-2xl font-semibold">{c.revenue !== null ? formatEuro(c.revenue) : "–"}</p>{p.lexQuotationNo && <p className="text-[11px] text-steel">Angebot {p.lexQuotationNo}</p>}</div>
        <div className="card p-4"><p className="text-xs text-steel">Kosten bisher</p><p className="text-xl sm:text-2xl font-semibold">{formatEuro(c.total)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Ergebnis</p><p className={clsx("text-xl sm:text-2xl font-semibold", tone)}>{c.margin !== null ? formatEuro(c.margin) : "–"}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Marge</p><p className={clsx("text-2xl font-semibold", tone)}>{c.marginPct !== null ? `${c.marginPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "–"}</p></div>
      </section>

      {c.used !== null && (
        <section className="card space-y-2 p-4">
          <div className="flex justify-between text-xs text-steel"><span>Verbraucht vom Auftragswert</span><span>{Math.round(c.used * 100)} %</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-mist">
            <div className={clsx("h-full rounded-full", c.used > 1 ? "bg-bad" : c.used > 0.85 ? "bg-warn" : "bg-brand")} style={{ width: `${Math.min(100, c.used * 100)}%` }} />
          </div>
        </section>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          <section className="card p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Calculator className="size-4 text-brand" /> Kosten</h2>
            <ul className="mt-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.label} className="flex items-center gap-3 py-2.5 text-sm">
                  <r.icon className="size-4 shrink-0 text-steel" />
                  <span className="min-w-0 flex-1"><span className="font-medium">{r.label}</span><span className="block text-xs text-steel">{r.detail}</span></span>
                  <span className="shrink-0 font-semibold">{formatEuro(r.amount)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between py-2.5 text-sm font-bold"><span>Summe</span><span>{formatEuro(c.total)}</span></li>
            </ul>
          </section>

          {c.byUser.length > 0 && (
            <section className="card p-4">
              <h2 className="font-semibold">Stunden je Mitarbeiter</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {c.byUser.map(([n, m]) => <li key={n} className="flex justify-between"><span>{n}</span><span className="text-steel">{formatHours(m)} · {formatEuro((m / 60) * c.rate)}</span></li>)}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <h2 className="font-semibold">Material aus dem Lager</h2>
            {c.materialLines.length === 0 ? (
              <p className="mt-2 text-sm text-steel">Noch keine Entnahmen auf dieses Projekt. Unter <Link href="/lager" className="text-brand">Lager</Link> beim Artikel „Entnahme“ mit diesem Projekt buchen.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {c.materialLines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-medium">{l.name}</span><span className="block text-xs text-steel">{formatDate(l.day)} · {l.qty.toLocaleString("de-DE", { maximumFractionDigits: 2 })} {l.unit} × {l.price !== null ? formatEuro(l.price) : "kein EK"}</span></span>
                    <span className={clsx("shrink-0 font-medium", l.missingPrice && "text-warn")}>{formatEuro(l.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {c.orders.length > 0 && (
            <section className="card p-4">
              <h2 className="font-semibold">Bestellt bei Lieferanten</h2>
              <ul className="mt-2 divide-y divide-line">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link href={`/lieferanten/anfrage/${o.id}`} className="min-w-0 flex-1 hover:text-brand"><span className="font-medium">{o.supplier}</span><span className="block truncate text-xs text-steel">{o.subject}</span></Link>
                    <span className="shrink-0 font-medium">{formatEuro(o.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Sonstige Kosten</h2>
            {c.costs.length > 0 && (
              <ul className="divide-y divide-line">
                {c.costs.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-medium">{k.label}</span><span className="block text-xs text-steel">{COST_LABEL[k.kind] ?? k.kind} · {formatDate(k.day)}{k.userName ? ` · ${k.userName}` : ""}</span></span>
                    <span className="shrink-0 font-medium">{formatEuro(k.amount)}</span>
                    <ActionButton action={deleteProjectCost.bind(null, k.id)} confirm="Posten löschen?" className="text-steel/60 hover:text-bad print:hidden" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="print:hidden">
              <StateForm action={addProjectCost.bind(null, p.id)} submit="Eintragen" submitClass="btn-secondary" reset>
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_8rem_9rem]">
                  <select name="kind" className="input" aria-label="Art" defaultValue="FREMDLEISTUNG">
                    {Object.entries(COST_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input name="label" required placeholder="z. B. Verzinkung Wiegel, Kranmiete" className="input" aria-label="Bezeichnung" />
                  <input name="amount" required inputMode="decimal" placeholder="€ netto" className="input" aria-label="Betrag netto" />
                  <input name="day" type="date" defaultValue={todayYmd()} className="input" aria-label="Datum" />
                </div>
              </StateForm>
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-5 print:hidden">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Auftragswert</h2>
            {quotes && quotes.length > 0 && (
              <StateForm action={linkQuotation.bind(null, p.id)} submit="Aus Lexware übernehmen" submitClass="btn-secondary">
                <select name="quotationId" className="input w-full" aria-label="Lexware-Angebot" defaultValue={p.lexQuotationId ?? ""}>
                  <option value="" disabled>Lexware-Angebot wählen …</option>
                  {quotes.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
              </StateForm>
            )}
            {lexLink && <a href={lexLink} target="_blank" rel="noreferrer" className="text-xs text-brand">Angebot {p.lexQuotationNo} in Lexware öffnen</a>}
            <StateForm action={saveCalcBasics.bind(null, p.id)} submit="Speichern" submitClass="btn-secondary">
              <label className="block text-xs text-steel">Auftragswert netto (€)<input name="budgetNet" inputMode="decimal" defaultValue={de(p.budgetNet)} placeholder={quotes ? "oder von Hand" : "z. B. 18.500"} className="input mt-1 w-full" /></label>
              <label className="block text-xs text-steel">Kosten-Stundensatz (€/Std.)<input name="hourlyRate" inputMode="decimal" defaultValue={de(p.hourlyRate)} placeholder={`Standard ${de(defaultHourlyRate())}`} className="input mt-1 w-full" /></label>
            </StateForm>
            <p className="text-xs text-steel">Der Stundensatz sind eure Kosten je Mitarbeiterstunde (Lohn + Nebenkosten + Gemeinkosten), nicht der Verkaufspreis.</p>
          </section>
          <section className="card space-y-2 p-4 text-sm text-steel">
            <h2 className="font-semibold text-ink">Was zählt</h2>
            <p>Stunden (Arbeit + Fahrt) aus Stempeluhr und Projekt, Entnahmen aus dem Lager zum Einkaufspreis, Lieferanten-Anfragen mit Status „Bestellt“, Spesen (ohne abgelehnte) und die sonstigen Kosten hier.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
