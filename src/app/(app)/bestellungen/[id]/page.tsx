import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageCheck, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, formatDateTime } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { canArea } from "@/lib/rights-shared";
import { BE_LABEL, BE_TONE, fmtNum, openQty, readLines, type BeStatus } from "@/lib/bestellungen-shared";
import { cancelSupplierOrder, setExpected } from "@/app/actions/bestellungen";
import { ActionButton } from "@/components/confirm-button";
import { PrintButton } from "@/components/print-button";
import { ReceiveForm } from "../forms";

export const dynamic = "force-dynamic";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = await db.supplierOrder.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: o ? `Bestellung ${o.number}` : "Bestellung" };
}

export default async function Bestellung({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const o = await db.supplierOrder.findUnique({
    where: { id },
    include: { supplier: true, project: { select: { id: true, name: true, address: true } }, request: { select: { id: true, subject: true } }, receipts: { orderBy: { createdAt: "desc" } } },
  });
  if (!o) notFound();
  const lines = readLines(o.lines);
  const st = o.status as BeStatus;
  const open = st === "BESTELLT" || st === "TEILGELIEFERT";
  const stock = canArea(me, "lager") ? await db.stockItem.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }) : [];
  const names = new Map(stock.map((s) => [s.id, s.name]));

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-10 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/bestellungen" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Bestellungen</Link>
        <PrintButton label="Bestellung drucken" />
      </div>

      <article className="card space-y-4 p-5 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand">Bestellung {o.number}</p>
            <h1 className="text-2xl font-bold tracking-tight">{o.supplier.name}</h1>
            <p className="text-sm text-steel">
              {o.project ? <>für <Link href={`/projekte/${o.project.id}`} className="text-brand">{o.project.name}</Link></> : "für das Lager"} · bestellt {formatDate(o.orderedAt)}{o.createdBy && ` von ${o.createdBy}`}
              {o.request && <> · aus <Link href={`/lieferanten/anfrage/${o.request.id}`} className="text-brand">Preisanfrage</Link></>}
            </p>
          </div>
          <div className="text-right">
            <span className={clsx("chip px-3 py-1 text-sm", BE_TONE[st])}>{BE_LABEL[st] ?? st}</span>
            {o.expectedAt && <p className={clsx("mt-1 text-sm", open && o.expectedAt < new Date() ? "font-semibold text-bad" : "text-steel")}>Liefertermin {formatDate(o.expectedAt)}</p>}
          </div>
        </header>

        <table className="w-full text-sm">
          <thead className="text-left text-xs text-steel"><tr><th className="py-1">Pos.</th><th>Artikel</th><th className="text-right">Menge</th><th className="text-right">Geliefert</th><th className="text-right">Preis</th><th className="text-right">Summe</th></tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2 text-steel">{i + 1}</td>
                <td>{l.text}{l.stockItemId && names.get(l.stockItemId) && <span className="block text-xs text-steel print:hidden">Lager: {names.get(l.stockItemId)}</span>}</td>
                <td className="text-right">{fmtNum(l.qty)} {l.unit ?? ""}</td>
                <td className={clsx("text-right", openQty(l) === 0 ? "text-ok" : l.received ? "text-warn" : "text-steel")}>{fmtNum(l.received)}</td>
                <td className="text-right">{l.price !== null ? eur(l.price) : "–"}</td>
                <td className="text-right font-medium">{l.price !== null ? eur(l.price * l.qty) : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5} className="pt-2 text-right font-semibold">Summe netto</td><td className="pt-2 text-right font-bold">{eur(o.totalNet)}</td></tr></tfoot>
        </table>
        {(o.note || o.supplierRef) && <p className="text-sm">{o.supplierRef && <><strong>AB/Bestell-Nr. Lieferant:</strong> {o.supplierRef}<br /></>}{o.note}</p>}
        {o.project?.address && <p className="hidden text-sm print:block"><strong>Lieferadresse/Baustelle:</strong> {o.project.address}</p>}
      </article>

      {open && stock.length + 1 > 0 && canArea(me, "lager") && (
        <section className="card space-y-3 p-5 print:hidden">
          <h2 className="flex items-center gap-2 font-semibold"><PackageCheck className="size-4 text-brand" /> Wareneingang</h2>
          <ReceiveForm orderId={o.id} lines={lines} stock={stock} />
        </section>
      )}

      {o.receipts.length > 0 && (
        <section className="card space-y-2 p-5 print:hidden">
          <h2 className="font-semibold">Lieferungen</h2>
          <ul className="divide-y divide-line text-sm">
            {o.receipts.map((r) => {
              const rl = (Array.isArray(r.lines) ? r.lines : []) as { index: number; qty: number }[];
              return (
                <li key={r.id} className="py-2">
                  <span className="font-medium">{formatDateTime(r.createdAt)}</span>{r.userName && ` · ${r.userName}`}{r.slipNo && ` · Lieferschein ${r.slipNo}`}
                  {r.fileId && <> · <a href={fileUrl(r.fileId)} target="_blank" rel="noreferrer" className="text-brand">Foto</a></>}
                  <span className="block text-xs text-steel">{rl.map((x) => `${fmtNum(x.qty)} ${lines[x.index]?.unit ?? ""} ${lines[x.index]?.text ?? ""}`).join(" · ")}{r.note && ` – ${r.note}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {open && canArea(me, "einkauf") && (
        <details className="card p-5 print:hidden">
          <summary className="cursor-pointer font-semibold">Liefertermin / Auftragsbestätigung</summary>
          <form action={setExpected.bind(null, o.id)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-steel">Liefertermin <input name="expectedAt" type="date" defaultValue={o.expectedAt ? berlinParts(o.expectedAt).ymd : ""} className="input mt-1" /></label>
            <label className="text-xs text-steel">AB/Bestell-Nr. <input name="supplierRef" defaultValue={o.supplierRef ?? ""} className="input mt-1" /></label>
            <button className="btn-secondary">Speichern</button>
            {st === "BESTELLT" && <ActionButton action={cancelSupplierOrder.bind(null, o.id)} confirm="Bestellung stornieren?" className="btn-secondary ml-auto text-bad"><XCircle className="size-4" /> Stornieren</ActionButton>}
          </form>
        </details>
      )}
    </main>
  );
}
