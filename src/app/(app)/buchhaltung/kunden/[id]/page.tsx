import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, FilePlus2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { isOverdue, statusText, openCentsOf } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { docLabel } from "@/lib/buchhaltung/types";
import { TONE } from "@/lib/buchhaltung/ui";
import { archiveCustomerAction, newDocAction } from "@/app/actions/buchhaltung";
import { ActionButton } from "@/components/confirm-button";
import { CustomerForm } from "../form";
import { CustomerFile } from "@/components/customer-file";

export const dynamic = "force-dynamic";

export default async function KundePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  const c = await db.customer.findUnique({ where: { id }, include: { docs: { orderBy: { date: "desc" }, take: 100 } } });
  if (!c) notFound();
  const open = c.docs.filter((d) => d.kind === "RECHNUNG" && d.status === "OFFEN").reduce((s, d) => s + openCentsOf(d), 0);
  const total = c.docs.filter((d) => d.kind === "RECHNUNG" && d.status !== "ENTWURF" && d.status !== "STORNIERT").reduce((s, d) => s + d.netCents, 0);
  return (
    <main className="space-y-4">
      <Link href="/buchhaltung/kunden" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Kunden</Link>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{c.name}</h1>
          <p className="mt-1 text-sm text-steel">{c.number ? `Kundennummer ${c.number}` : "ohne Kundennummer"}{c.lexId ? " · aus Lexware übernommen" : ""}{c.archived ? " · archiviert" : ""}</p>
        </div>
        <form action={newDocAction.bind(null, "ANGEBOT", { customerId: c.id })}><button className="btn-secondary"><FilePlus2 className="size-4" /> Angebot</button></form>
        <form action={newDocAction.bind(null, "RECHNUNG", { customerId: c.id })}><button className="btn-primary"><FilePlus2 className="size-4" /> Rechnung</button></form>
      </div>
      <section className="grid grid-cols-2 gap-3">
        <div className="card p-4"><p className="text-xs text-steel">Offen</p><p className="text-xl font-semibold">{fmtEuroCents(open)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Umsatz gesamt (netto)</p><p className="text-xl font-semibold">{fmtEuroCents(total)}</p></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Stammdaten</h2>
          <CustomerForm c={c} />
          <div className="mt-3 border-t border-line pt-3">
            <ActionButton action={archiveCustomerAction.bind(null, c.id, !c.archived)} confirm={c.archived ? undefined : "Kunden archivieren? Er erscheint dann nicht mehr in der Auswahl. Belege bleiben erhalten."} className="btn-secondary"><Archive className="size-4" /> {c.archived ? "Wieder aktivieren" : "Archivieren"}</ActionButton>
          </div>
        </section>
        <section className="card p-4">
          <h2 className="font-semibold">Angebote und Rechnungen</h2>
          {c.docs.length === 0 ? <p className="mt-2 text-sm text-steel">Noch keine Belege.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {c.docs.map((d) => (
                <li key={d.id}><Link href={`/buchhaltung/beleg/${d.id}`} className="flex items-center gap-2 py-2 hover:text-brand"><span className="min-w-0 flex-1 truncate"><strong>{docLabel(d)} {d.number ?? "(Entwurf)"}</strong>{d.title ? ` · ${d.title}` : ""}</span><span className="text-xs text-steel">{formatDate(d.date)}</span><span className="w-24 text-right font-semibold">{fmtEuroCents(d.grossCents)}</span><span className={clsx("chip", isOverdue(d) ? TONE.UEBERFAELLIG : TONE[d.status])}>{statusText(d)}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {/* EPS-Kundenakte: Aufträge, Anfragen, Kontakthistorie, Wiedervorlagen, Dokumente */}
      <CustomerFile customerId={c.id} />
    </main>
  );
}
