import Link from "next/link";
import { Box, Calculator, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { steelPrices } from "@/lib/steel-prices";
import { kalkValues } from "@/lib/vorlagen/kalk";
import { HOURS_LABEL, KALK_LABEL, PRODUCT_LABEL, PRODUCT_UNIT, PRODUCTS, type Product } from "@/lib/vorlagen/model";
import { saveKalkForm } from "@/app/actions/vorlagen";
import { STATUS_LABEL } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { StateForm } from "@/components/state-form";
import { Configurator } from "./configurator";

export const metadata = { title: "Angebotsvorlagen" };
export const dynamic = "force-dynamic";

const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default async function VorlagenPage({ searchParams }: { searchParams: Promise<{ produkt?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const initial = (PRODUCTS as readonly string[]).includes(sp.produkt ?? "") ? (sp.produkt as Product) : "GELAENDER";
  const [steel, kalk, customers, projects, recent] = await Promise.all([
    steelPrices(),
    kalkValues(),
    db.customer.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, number: true }, take: 2000 }),
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 200 }),
    db.productConfig.findMany({ orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, product: true, token: true, createdAt: true, createdBy: true, doc: { select: { id: true, number: true, status: true, netCents: true, customer: { select: { name: true } } } } } }),
  ]);
  const admin = user.role === "ADMIN";

  return (
    <main className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2"><Calculator className="size-6 text-brand" /> Angebotsvorlagen</h1>
        <p className="mt-1 text-sm text-steel">Geländer, Treppe, Vordach oder Tor mit Maßen eingeben – Jarvis rechnet Material aus dem Stahl-Katalog, Arbeitszeit und Beschichtung und legt das Angebot mit 3D-Ansicht an.</p>
      </div>

      <Configurator steel={steel} kalk={kalk} customers={customers} projects={projects} initial={initial} admin={admin} />

      {recent.length > 0 && (
        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Box className="size-4 text-brand" /> Zuletzt kalkuliert</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>
                  <span className="block text-xs text-steel">{PRODUCT_LABEL[r.product as Product] ?? r.product} · {formatDate(r.createdAt)}{r.createdBy ? ` · ${r.createdBy}` : ""}{r.doc?.customer ? ` · ${r.doc.customer.name}` : ""}</span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {r.doc && <Link href={`/buchhaltung/beleg/${r.doc.id}`} className="font-medium text-brand hover:underline">Angebot {r.doc.number ?? "Entwurf"} · {fmtEuroCents(r.doc.netCents)} netto · {STATUS_LABEL[r.doc.status]}</Link>}
                  <a href={`/3d/${r.token}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-steel hover:text-brand"><ExternalLink className="size-3.5" /> 3D-Link</a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="kalk" className="card scroll-mt-20 p-4">
        <h2 className="font-semibold">Kalkulationswerte</h2>
        <p className="mt-1 text-sm text-steel">
          Deine eigenen Sätze – nichts ist vorbelegt. Fehlt ein Wert, rechnet Jarvis keinen Preis. Stahlpreise (€/kg, Verzinken) stehen im <Link href="/lieferanten/stahl" className="text-brand underline">Stahl-Katalog</Link>.
          {kalk.stand ? ` Stand ${formatDate(kalk.stand)}.` : ""}
        </p>
        {admin ? (
          <StateForm action={saveKalkForm} submit="Werte speichern" className="mt-3 space-y-4">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {(Object.keys(KALK_LABEL) as (keyof typeof KALK_LABEL)[]).map((k) => (
                <label key={k} className="text-xs text-steel">{KALK_LABEL[k]}<input name={k} inputMode="decimal" defaultValue={val(kalk[k])} className="input mt-1 w-full" /></label>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-xs text-steel">
                  <tr><th className="py-1 font-medium">Arbeitszeit</th>{Object.values(HOURS_LABEL).map((h) => <th key={h} className="py-1 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {PRODUCTS.map((p) => (
                    <tr key={p}>
                      <td className="py-1 pr-2">{PRODUCT_LABEL[p]}<span className="block text-xs text-steel">Einheit: {PRODUCT_UNIT[p].unit}</span></td>
                      {(Object.keys(HOURS_LABEL) as (keyof typeof HOURS_LABEL)[]).map((h) => (
                        <td key={h} className="py-1 pr-2"><input name={`${p}_${h}`} inputMode="decimal" defaultValue={val(kalk.zeiten[p][h])} aria-label={`${PRODUCT_LABEL[p]} ${HOURS_LABEL[h]}`} className="input w-full" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StateForm>
        ) : (
          <p className="mt-2 text-sm text-steel">Ändern kann nur ein Administrator.</p>
        )}
      </section>
    </main>
  );
}
