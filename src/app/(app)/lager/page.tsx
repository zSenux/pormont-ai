import Link from "next/link";
import { AlertTriangle, Boxes, Plus, Search } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatEuro } from "@/lib/berlin";
import { CATEGORY_LABEL, fmtQty, isLow, lowStock, STOCK_CATEGORIES, type StockCategory } from "@/lib/stock";
import { ReorderButton, StockItemForm } from "./forms";

export const metadata = { title: "Lager" };
export const dynamic = "force-dynamic";

export default async function LagerPage({ searchParams }: { searchParams: Promise<{ q?: string; gruppe?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const cat = STOCK_CATEGORIES.includes(sp.gruppe as StockCategory) ? (sp.gruppe as StockCategory) : null;
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
  const [items, low, suppliers, all] = await Promise.all([
    db.stockItem.findMany({
      where: { ...(cat ? { category: cat } : {}), AND: words.map((w) => ({ OR: [{ name: ci(w) }, { material: ci(w) }, { articleNo: ci(w) }, { location: ci(w) }] })) },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 300,
      include: { supplier: { select: { name: true } } },
    }),
    lowStock(),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.stockItem.findMany({ select: { quantity: true, price: true, category: true } }),
  ]);
  const value = all.reduce((s, i) => s + Math.max(0, i.quantity) * (i.price ?? 0), 0);
  const counts = all.reduce((m, i) => m.set(i.category, (m.get(i.category) ?? 0) + 1), new Map<string, number>());

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Materiallager</h1>
        <p className="mt-1 text-sm text-steel">Profile, Bleche, Schrauben und Schlosserteile: Bestand, Entnahmen auf Baustellen, rechtzeitig nachbestellen.</p>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-xs text-steel">Artikel</p><p className="text-2xl font-semibold">{all.length}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Nachbestellen</p><p className={clsx("text-2xl font-semibold", low.length ? "text-warn" : "")}>{low.length}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Lagerwert (EK)</p><p className="text-lg font-semibold sm:text-2xl">{formatEuro(value)}</p></div>
      </section>

      {low.length > 0 && (
        <section className="card border-amber-300 bg-amber-50/60 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="size-4" /> Unter Mindestbestand</h2>
          <ul className="mt-2 divide-y divide-amber-200">
            {low.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Link href={`/lager/${i.id}`} className="min-w-0 basis-full font-medium hover:text-brand sm:basis-auto sm:flex-1">{i.name}{i.material ? <span className="font-normal text-steel"> · {i.material}</span> : null}</Link>
                <span className="flex-1 text-xs text-steel sm:flex-none">noch {fmtQty(i.quantity, i.unit)} · min. {fmtQty(i.minQuantity ?? 0, i.unit)}{i.supplier ? ` · ${i.supplier.name}` : ""}</span>
                {i.supplier ? <ReorderButton itemId={i.id} className="btn-secondary px-3 py-1 text-xs" /> : <Link href={`/lager/${i.id}`} className="text-xs text-brand">Lieferant hinterlegen</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-4">
          <form className="flex gap-2" action="/lager">
            {cat && <input type="hidden" name="gruppe" value={cat} />}
            <input name="q" defaultValue={q} placeholder="Suchen: HEA, 50x8, V2A, Regal …" className="input min-w-0 flex-1" aria-label="Lager durchsuchen" />
            <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/lager" className={clsx("chip px-3 py-1", !cat ? "border-brand bg-brand text-white" : "bg-white text-steel")}>Alle</Link>
            {STOCK_CATEGORIES.filter((c) => counts.get(c)).map((c) => (
              <Link key={c} href={`/lager?gruppe=${c}`} className={clsx("chip px-3 py-1", cat === c ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{CATEGORY_LABEL[c]} {counts.get(c)}</Link>
            ))}
          </div>
          <ul className="card divide-y divide-line">
            {items.length === 0 && <li className="p-5 text-sm text-steel">{all.length ? "Nichts gefunden." : "Noch keine Lagerartikel. Rechts anlegen – oder aus einem Lieferanten-Katalog übernehmen."}</li>}
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/lager/${i.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-mist">
                  <Boxes className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-steel">{[i.material, i.location, i.supplier?.name, i.price !== null ? `${formatEuro(i.price)}/${i.unit}` : null].filter(Boolean).join(" · ") || CATEGORY_LABEL[i.category as StockCategory]}</span>
                  </span>
                  <span className={clsx("shrink-0 text-right text-sm font-semibold", isLow(i) ? "text-warn" : i.quantity <= 0 ? "text-bad" : "")}>
                    {fmtQty(i.quantity, i.unit)}
                    {i.minQuantity !== null && <span className="block text-[11px] font-normal text-steel">min. {fmtQty(i.minQuantity)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <aside className="min-w-0 space-y-5">
          <details className="card p-4" open={all.length === 0}>
            <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Artikel anlegen</summary>
            <div className="mt-3"><StockItemForm suppliers={suppliers} /></div>
          </details>
          <section className="card space-y-2 p-4 text-sm text-steel">
            <h2 className="font-semibold text-ink">So geht’s</h2>
            <p>Entnahmen auf ein Projekt buchen – sie landen mit Einkaufspreis in der Nachkalkulation.</p>
            <p>Unter Mindestbestand legt „Nachbestellen“ eine Preisanfrage beim Lieferanten an. Gesendet wird erst nach deinem Klick.</p>
            <p>Oder einfach zu Jarvis: „Buch 6 Meter Flachstahl 50x8 auf Lindenhof aus.“</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
