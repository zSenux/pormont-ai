import Link from "next/link";
import { AlertTriangle, Handshake, Plus, Search } from "lucide-react";
import { clsx } from "clsx";
import { formatDate } from "@/lib/berlin";
import { expiringNuDocs, listSubcontractors } from "@/lib/nachunternehmer";
import { AMPEL_LABEL, AMPEL_TONE, daysLeft, NU_DOC_LABEL, NU_DOC_SHORT, NU_REQUIRED, expiryState, EXPIRY_TONE, latestByKind, type NuDocKind } from "@/lib/nachunternehmer-shared";
import { newSubcontractor } from "@/app/actions/nachunternehmer";
import { StateForm } from "@/components/state-form";

export const metadata = { title: "Nachunternehmer" };
export const dynamic = "force-dynamic";

export default async function NachunternehmerPage({ searchParams }: { searchParams: Promise<{ q?: string; alle?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const [subs, expiring] = await Promise.all([listSubcontractors({ q, all: sp.alle === "1" }), expiringNuDocs()]);
  const red = subs.filter((s) => s.check.ampel === "rot").length;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Nachunternehmer</h1>
        <p className="mt-1 text-sm text-steel">Subunternehmer mit Verträgen und Nachweisen – Freistellung nach § 48b, Unbedenklichkeit, Versicherung. Jarvis warnt rechtzeitig vor dem Ablauf.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-sm text-steel">Aktive Nachunternehmer</p><p className="text-3xl font-extrabold text-brand">{subs.length}</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Nachweis fehlt/abgelaufen</p><p className={clsx("text-3xl font-extrabold", red ? "text-bad" : "text-ok")}>{red}</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Läuft in 30 Tagen ab</p><p className={clsx("text-3xl font-extrabold", expiring.length ? "text-warn" : "text-ok")}>{expiring.length}</p></div>
      </div>

      {expiring.length > 0 && (
        <section className="card border-warn/40 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warn" /> Ablaufende Nachweise</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {expiring.map((d) => {
              const left = d.validUntil ? daysLeft(d.validUntil) : 0;
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/nachunternehmer/${d.subcontractor.id}`} className="font-medium hover:underline">{d.subcontractor.name}</Link> · {NU_DOC_LABEL[d.kind as NuDocKind] ?? d.kind}</span>
                  <span className={clsx("chip", left < 0 ? EXPIRY_TONE.abgelaufen : EXPIRY_TONE.bald)}>{left < 0 ? `abgelaufen seit ${formatDate(d.validUntil)}` : `bis ${formatDate(d.validUntil)} · noch ${left} Tage`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <form className="flex gap-2" action="/nachunternehmer">
            <input name="q" defaultValue={q} placeholder="Name oder Gewerk" className="input w-56" aria-label="Suche" />
            <button className="btn-secondary px-3" aria-label="Suchen"><Search className="size-4" /></button>
          </form>
          <Link href={sp.alle === "1" ? "/nachunternehmer" : "/nachunternehmer?alle=1"} className="text-sm text-steel hover:text-brand">{sp.alle === "1" ? "Nur aktive" : "Auch inaktive zeigen"}</Link>
        </div>
        {subs.length === 0 ? (
          <p className="py-8 text-center text-steel">Noch keine Nachunternehmer erfasst.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {subs.map((s) => {
              const best = latestByKind(s.docs);
              return (
                <li key={s.id} className="py-3">
                  <Link href={`/nachunternehmer/${s.id}`} className="flex flex-wrap items-center gap-3">
                    <span className={clsx("size-3 shrink-0 rounded-full", AMPEL_TONE[s.check.ampel])} title={AMPEL_LABEL[s.check.ampel]} />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{s.name}</span>{!s.active && <span className="ml-2 chip bg-mist text-steel">inaktiv</span>}
                      <span className="block text-xs text-steel">{[s.trade, s.city, `${s.contracts.length} ${s.contracts.length === 1 ? "Vertrag" : "Verträge"}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {NU_REQUIRED.map((k) => {
                        const d = best.get(k);
                        const st = d ? expiryState(d.validUntil) : "abgelaufen";
                        return <span key={k} className={clsx("chip text-[11px]", d ? EXPIRY_TONE[st] : "border-bad/30 bg-white text-bad line-through")} title={d ? `${NU_DOC_LABEL[k]} bis ${formatDate(d.validUntil)}` : `${NU_DOC_LABEL[k]} fehlt`}>{NU_DOC_SHORT[k]}</span>;
                      })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="card p-5">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Nachunternehmer anlegen</summary>
        <StateForm action={newSubcontractor} className="mt-3 grid gap-2 sm:grid-cols-2" submit={<><Handshake className="size-4" /> Anlegen</>}>
          <input name="name" required placeholder="Firma *" className="input sm:col-span-2" aria-label="Firma" />
          <input name="trade" placeholder="Gewerk (z. B. Verzinkung, Kran, Montage)" className="input" aria-label="Gewerk" />
          <input name="contactName" placeholder="Ansprechpartner" className="input" aria-label="Ansprechpartner" />
          <input name="phone" placeholder="Telefon" className="input" aria-label="Telefon" />
          <input name="email" type="email" placeholder="E-Mail" className="input" aria-label="E-Mail" />
          <input name="street" placeholder="Straße" className="input" aria-label="Straße" />
          <div className="grid grid-cols-[6rem_1fr] gap-2"><input name="zip" placeholder="PLZ" className="input" aria-label="PLZ" /><input name="city" placeholder="Ort" className="input" aria-label="Ort" /></div>
          <input name="taxNumber" placeholder="Steuernummer (für § 48b-Prüfung)" className="input sm:col-span-2" aria-label="Steuernummer" />
        </StateForm>
      </details>
    </main>
  );
}
