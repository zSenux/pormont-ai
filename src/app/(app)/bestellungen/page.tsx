import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { canArea } from "@/lib/rights-shared";
import { BE_LABEL, BE_STATUSES, BE_TONE, openQty, readLines, type BeStatus } from "@/lib/bestellungen-shared";
import { NewOrderForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bestellungen" };

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default async function Bestellungen({ searchParams }: { searchParams: Promise<{ status?: string; projekt?: string; neu?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = BE_STATUSES.includes(sp.status as BeStatus) ? (sp.status as BeStatus) : undefined;
  const now = new Date();
  const [list, suppliers, projects, counts] = await Promise.all([
    db.supplierOrder.findMany({ where: status ? { status } : { status: { in: ["BESTELLT", "TEILGELIEFERT"] } }, orderBy: [{ expectedAt: { sort: "asc", nulls: "last" } }, { orderedAt: "desc" }], take: 200, include: { supplier: { select: { name: true } }, project: { select: { id: true, name: true } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.supplierOrder.groupBy({ by: ["status"], _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const mayOrder = canArea(me, "einkauf");

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Bestellungen</h1>
        <p className="mt-1 text-sm text-steel">Material beim Lieferanten bestellen und beim Wareneingang abhaken – Lagerartikel werden dabei automatisch zugebucht. Preisanfragen findest du unter <Link href="/lieferanten" className="text-brand">Lieferanten</Link>.</p>
      </div>
      {mayOrder && (
        <details id="neu" className="card p-5" open={Boolean(sp.projekt || sp.neu)}>
          <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Neue Bestellung</summary>
          <div className="mt-3"><NewOrderForm suppliers={suppliers} projects={projects} projectId={sp.projekt} /></div>
          {suppliers.length === 0 && <p className="mt-2 text-sm text-warn">Noch keine Lieferanten – zuerst unter Lieferanten anlegen.</p>}
        </details>
      )}
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter">
        <Link href="/bestellungen" className={clsx("chip px-3 py-1", !status ? "border-brand bg-brand text-white" : "bg-white")}>Offen ({n("BESTELLT") + n("TEILGELIEFERT")})</Link>
        {BE_STATUSES.map((s) => <Link key={s} href={`/bestellungen?status=${s}`} className={clsx("chip px-3 py-1", status === s ? "border-brand bg-brand text-white" : "bg-white")}>{BE_LABEL[s]} ({n(s)})</Link>)}
      </nav>
      {list.length === 0 ? (
        <p className="card p-5 text-sm text-steel">Keine Bestellungen.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((o) => {
            const lines = readLines(o.lines);
            const open = lines.filter((l) => openQty(l) > 0).length;
            const late = o.expectedAt && o.expectedAt < now && (o.status === "BESTELLT" || o.status === "TEILGELIEFERT");
            return (
              <li key={o.id}>
                <Link href={`/bestellungen/${o.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-mist/50">
                  <ShoppingCart className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.number} · {o.supplier.name}</span>
                    <span className="block truncate text-xs text-steel">{o.project ? o.project.name : "Lager"} · {lines.length} Pos.{open && o.status !== "STORNIERT" && o.status !== "GELIEFERT" ? `, ${open} offen` : ""} · bestellt {formatDate(o.orderedAt)}</span>
                  </span>
                  {o.expectedAt && <span className={clsx("text-xs", late ? "font-semibold text-bad" : "text-steel")}>{late ? "überfällig seit " : "Liefertermin "}{formatDate(o.expectedAt)}</span>}
                  <span className="w-24 text-right text-sm font-semibold">{o.totalNet ? eur(o.totalNet) : "–"}</span>
                  <span className={clsx("chip px-2 py-0.5 text-[11px]", BE_TONE[o.status as BeStatus])}>{BE_LABEL[o.status as BeStatus] ?? o.status}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
