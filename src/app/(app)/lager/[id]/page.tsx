import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDateTime, formatEuro } from "@/lib/berlin";
import { CATEGORY_LABEL, fmtQty, isLow, MOVE_LABEL, type StockCategory } from "@/lib/stock";
import { deleteStockItem } from "@/app/actions/lager";
import { ActionButton } from "@/components/confirm-button";
import { BookForm, ReorderButton, StockItemForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const i = await db.stockItem.findUnique({ where: { id: id.data }, include: { supplier: { select: { id: true, name: true } }, moves: { orderBy: { createdAt: "desc" }, take: 100, include: { project: { select: { id: true, name: true } } } } } });
  if (!i) notFound();
  const [projects, suppliers] = await Promise.all([
    db.project.findMany({ where: { status: { in: ["PLANUNG", "LAEUFT"] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const low = isLow(i);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/lager" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Lager</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{i.name}</h1>
          <p className="mt-1 text-sm text-steel">{[CATEGORY_LABEL[i.category as StockCategory], i.material, i.location, i.articleNo ? `Art.-Nr. ${i.articleNo}` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right">
          <p className={clsx("text-3xl font-bold", low ? "text-warn" : i.quantity <= 0 ? "text-bad" : "text-ink")}>{fmtQty(i.quantity, i.unit)}</p>
          <p className="text-xs text-steel">{i.minQuantity !== null ? `Mindestbestand ${fmtQty(i.minQuantity, i.unit)}` : "kein Mindestbestand"}{i.price !== null ? ` · EK ${formatEuro(i.price)}/${i.unit}` : ""}</p>
        </div>
      </div>

      {low && (
        <section className="card flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50/60 p-4 text-sm">
          <AlertTriangle className="size-5 text-warn" />
          <p className="min-w-0 flex-1">Unter Mindestbestand.{i.supplier ? ` Nachbestellen bei ${i.supplier.name}${i.reorderQty ? ` (${fmtQty(i.reorderQty, i.unit)})` : ""} – du siehst die Anfrage vor dem Senden.` : " Hinterleg unten einen Lieferanten, dann geht Nachbestellen mit einem Klick."}</p>
          {i.supplier && <ReorderButton itemId={i.id} className="btn-primary" />}
        </section>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Buchen</h2>
            <BookForm itemId={i.id} unit={i.unit} price={i.price} projects={projects} />
          </section>
          <section className="card p-4">
            <h2 className="font-semibold">Bewegungen</h2>
            <ul className="mt-2 divide-y divide-line">
              {i.moves.length === 0 && <li className="py-2 text-sm text-steel">Noch keine.</li>}
              {i.moves.map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{MOVE_LABEL[m.kind] ?? m.kind}</span>
                    {m.project && <> · <Link href={`/projekte/${m.project.id}/nachkalkulation`} className="text-brand">{m.project.name}</Link></>}
                    {m.note && <span className="text-steel"> · {m.note}</span>}
                    <span className="block text-xs text-steel">{formatDateTime(m.createdAt)}{m.userName ? ` · ${m.userName}` : ""}{m.price !== null ? ` · ${formatEuro(m.price)}/${i.unit}` : ""}</span>
                  </span>
                  <span className={clsx("shrink-0 font-semibold", m.delta < 0 ? "text-bad" : "text-ok")}>{m.delta > 0 ? "+" : ""}{fmtQty(m.delta, i.unit)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="min-w-0 space-y-5">
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Daten bearbeiten</summary>
            <div className="mt-3"><StockItemForm item={i} suppliers={suppliers} /></div>
          </details>
          {i.supplier && <p className="px-1 text-sm text-steel">Lieferant: <Link href={`/lieferanten/${i.supplier.id}`} className="text-brand">{i.supplier.name}</Link></p>}
          {i.notes && <p className="card whitespace-pre-line p-4 text-sm text-steel">{i.notes}</p>}
          <ActionButton action={deleteStockItem.bind(null, i.id)} confirm={`${i.name} mit allen Buchungen löschen? Projekt-Entnahmen fallen dann aus der Nachkalkulation.`} className="btn-danger"><Trash2 className="size-4" /> Löschen</ActionButton>
        </aside>
      </div>
    </main>
  );
}
