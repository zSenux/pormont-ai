import Link from "next/link";
import { BookOpen, ClipboardList, Mail, Plus, Search, Sparkles, Truck, Weight } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatEuro } from "@/lib/berlin";
import { KIND_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, SUPPLIER_SUGGESTIONS, type SupplierKindKey } from "@/lib/suppliers";
import { priceText, searchCatalog } from "@/lib/catalog";
import { addSuggestedSuppliers } from "@/app/actions/lieferanten";
import { ActionButton } from "@/components/confirm-button";
import { SupplierForm } from "./forms";

export const metadata = { title: "Lieferanten" };
export const dynamic = "force-dynamic";

export default async function LieferantenPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = (await searchParams).q?.trim().slice(0, 80) ?? "";
  const [suppliers, open, hits] = await Promise.all([
    db.supplier.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], include: { _count: { select: { items: true, requests: true } } } }),
    db.supplierRequest.findMany({ where: { status: { in: ["ENTWURF", "GESENDET", "ANGEBOT"] } }, orderBy: { createdAt: "desc" }, take: 20, include: { supplier: { select: { name: true } }, project: { select: { name: true } } } }),
    q ? searchCatalog(q, { take: 40 }) : Promise.resolve([]),
  ]);
  const missing = SUPPLIER_SUGGESTIONS.filter((s) => !suppliers.some((x) => x.name.toLowerCase() === s.name.toLowerCase()));
  const items = suppliers.reduce((n, s) => n + s._count.items, 0);

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Lieferanten</h1>
          <p className="mt-1 text-sm text-steel">Stahl, Verzinkerei und Schlosserteile: Preisanfragen schicken, Angebote vergleichen, im Katalog nachschlagen.</p>
        </div>
        <Link href="/lieferanten/stahl" className="btn-secondary"><Weight className="size-4" /> Stahl-Katalog</Link>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-xs text-steel">Lieferanten</p><p className="text-2xl font-semibold">{suppliers.length}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Offene Anfragen</p><p className="text-2xl font-semibold text-brand">{open.length}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Katalog-Artikel</p><p className="text-2xl font-semibold">{items.toLocaleString("de-DE")}</p></div>
      </section>

      <form className="flex gap-2" action="/lieferanten">
        <input name="q" defaultValue={q} placeholder="Im Katalog suchen: z. B. „Torrolle 80“, „Flachstahl 50x8“, Artikelnummer …" className="input min-w-0 flex-1" aria-label="Katalog durchsuchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>

      {q && (
        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-brand" /> Katalog: „{q}“ <span className="text-sm font-normal text-steel">{hits.length}{hits.length === 40 ? "+" : ""} Treffer</span></h2>
          {hits.length === 0 ? (
            <p className="mt-2 text-sm text-steel">Nichts gefunden.{items === 0 ? " Es ist noch kein Katalog importiert – beim Lieferanten „Katalog / Preisliste hochladen“." : ""}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {hits.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">{h.name}</span>{h.description ? <span className="text-steel"> · {h.description}</span> : null}<span className="block text-xs text-steel">Nr. {h.articleNo}{h.group ? ` · ${h.group}` : ""} · <Link href={`/lieferanten/${h.supplier.id}`} className="text-brand">{h.supplier.name}</Link></span></span>
                  <span className="shrink-0 font-semibold">{priceText(h)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          {missing.length > 0 && (
            <section className="card flex flex-wrap items-center gap-3 border-brand/30 bg-brand-soft p-4">
              <Sparkles className="size-5 shrink-0 text-brand" />
              <p className="min-w-0 flex-1 text-sm">Vorschlag: {missing.map((s) => s.name).join(", ")} anlegen. Kontaktdaten trägst du danach nach.</p>
              <ActionButton action={addSuggestedSuppliers} className="btn-primary">Anlegen</ActionButton>
            </section>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {suppliers.length === 0 && <li className="card p-5 text-sm text-steel sm:col-span-2">Noch keine Lieferanten.</li>}
            {suppliers.map((s) => (
              <li key={s.id}>
                <Link href={`/lieferanten/${s.id}`} className="card flex h-full flex-col gap-2 p-4 transition hover:border-brand">
                  <div className="flex items-start gap-2">
                    <Truck className="mt-0.5 size-4 shrink-0 text-brand" />
                    <p className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{s.name}</p>
                    <span className="chip shrink-0 bg-mist px-2 py-0.5 text-[11px] text-steel">{KIND_LABEL[s.kind as SupplierKindKey]}</span>
                  </div>
                  <p className="text-xs text-steel">{[s.contactName, s.city].filter(Boolean).join(" · ") || "–"}</p>
                  <p className="mt-auto flex flex-wrap gap-x-3 text-xs text-steel">
                    <span className={clsx("flex items-center gap-1", !s.email && "text-warn")}><Mail className="size-3" /> {s.email ? "E-Mail" : "E-Mail fehlt"}</span>
                    <span>{s._count.requests} Anfragen</span>
                    <span>{s._count.items.toLocaleString("de-DE")} Artikel</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="card p-4">
            <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-brand" /> Offene Anfragen</h2>
            {open.length === 0 ? (
              <p className="mt-2 text-sm text-steel">Keine. Sag einfach zu Jarvis: „Frag bei Haug 12 HEA 200 an.“</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {open.map((r) => (
                  <li key={r.id}>
                    <Link href={`/lieferanten/anfrage/${r.id}`} className="flex items-start gap-2 py-2 text-sm hover:text-brand">
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.supplier.name}</span><span className="block truncate text-xs text-steel">{r.project?.name ?? r.subject}</span></span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={clsx("chip px-2 py-0.5 text-[11px]", REQUEST_STATUS_TONE[r.status])}>{REQUEST_STATUS_LABEL[r.status]}</span>
                        <span className="text-[11px] text-steel">{r.offerAmount !== null ? formatEuro(r.offerAmount) : formatDate(r.sentAt ?? r.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <details className="card p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Lieferant anlegen</summary>
            <div className="mt-3"><SupplierForm /></div>
          </details>
        </aside>
      </div>
    </main>
  );
}
