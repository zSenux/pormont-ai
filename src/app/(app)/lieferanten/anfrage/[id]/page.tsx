import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShoppingCart, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE } from "@/lib/suppliers";
import { deleteRequest } from "@/app/actions/lieferanten";
import { supplierOrderFromRequest } from "@/app/actions/bestellungen";
import { BE_LABEL, BE_TONE, type BeStatus } from "@/lib/bestellungen-shared";
import { ActionButton } from "@/components/confirm-button";
import { RequestStatusForm, RequestTextForm, SendRequestButton } from "../../forms";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const r = await db.supplierRequest.findUnique({ where: { id: id.data }, include: { supplier: true, project: { select: { id: true, name: true } }, orders: { orderBy: { orderedAt: "desc" }, select: { id: true, number: true, status: true } } } });
  if (!r) notFound();
  const draft = r.status === "ENTWURF";

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href={`/lieferanten/${r.supplierId}`} className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> {r.supplier.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Preisanfrage</h1>
          <p className="mt-1 text-sm text-steel">
            An {r.supplier.name}{r.supplier.email ? ` <${r.supplier.email}>` : ""}
            {r.project && <> · Projekt <Link href={`/projekte/${r.project.id}`} className="text-brand">{r.project.name}</Link></>}
            {r.dueAt && ` · Antwort bis ${formatDate(r.dueAt)}`}
          </p>
        </div>
        <span className={clsx("chip px-3 py-1", REQUEST_STATUS_TONE[r.status])}>{REQUEST_STATUS_LABEL[r.status]}</span>
      </div>

      {r.error && <p className="card border-bad/30 bg-red-50 p-3 text-sm text-bad">Letzter Sendeversuch fehlgeschlagen: {r.error}</p>}

      {draft ? (
        <section className="card space-y-4 p-4">
          <h2 className="font-semibold">Mail prüfen</h2>
          <RequestTextForm id={r.id} subject={r.subject} text={r.text} />
          <div className="border-t border-line pt-4">
            <SendRequestButton id={r.id} to={r.supplier.email} />
            <p className="mt-2 text-xs text-steel">Die Mail geht vom Firmenpostfach raus und liegt danach im Ordner „Gesendet“. Antworten kommen ganz normal unter Mail an.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Angebot erfassen</h2>
            <RequestStatusForm id={r.id} status={r.status} offerAmount={r.offerAmount} offerNote={r.offerNote} />
          </section>
          <section className="card space-y-2 p-4">
            <h2 className="font-semibold">Bestellung</h2>
            {r.orders.map((o) => (
              <Link key={o.id} href={`/bestellungen/${o.id}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">
                <span className="font-medium">{o.number}</span>
                <span className={clsx("chip", BE_TONE[o.status as BeStatus])}>{BE_LABEL[o.status as BeStatus] ?? o.status}</span>
              </Link>
            ))}
            {r.orders.length === 0 && (
              <>
                <p className="text-sm text-steel">Angebot passt? Dann daraus eine Bestellung machen – die Positionen werden übernommen, beim Wareneingang wird ins Lager gebucht.</p>
                <ActionButton action={supplierOrderFromRequest.bind(null, r.id)} confirm="Bestellung aus dieser Anfrage anlegen?" className="btn-primary"><ShoppingCart className="size-4" /> Bestellung anlegen</ActionButton>
              </>
            )}
          </section>
          <section className="card p-4">
            <p className="text-xs text-steel">Gesendet {formatDateTime(r.sentAt)} an {r.sentTo}{r.createdBy ? ` · angelegt von ${r.createdBy}` : ""}</p>
            <p className="mt-2 font-medium">{r.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{r.text}</p>
          </section>
        </>
      )}
      <ActionButton action={deleteRequest.bind(null, r.id)} confirm="Anfrage löschen?" className="btn-secondary text-bad"><Trash2 className="size-4" /> Anfrage löschen</ActionButton>
    </main>
  );
}
