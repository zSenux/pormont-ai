import Link from "next/link";
import { AlertTriangle, FilePlus2, FileText, Landmark, Receipt, Settings, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { bookConfig, missingForInvoices } from "@/lib/buchhaltung/config";
import { customerName, openInvoices, revenue, openCentsOf } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { docLabel } from "@/lib/buchhaltung/types";
import { purchaseTotals, unbookedReceiptsWhere } from "@/lib/buchhaltung/purchases";
import { newDocAction } from "@/app/actions/buchhaltung";

export const metadata = { title: "Buchhaltung" };
export const dynamic = "force-dynamic";

export default async function BuchhaltungPage() {
  const user = await requireUser();
  const today = todayYmd();
  const p = berlinParts();
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${p.y}-01-01`;
  const [cfg, open, month, year, quotes, drafts, recent, customers, costs, bankOpen, photos] = await Promise.all([
    bookConfig(),
    openInvoices(),
    revenue(monthStart, today),
    revenue(yearStart, today),
    db.salesDoc.aggregate({ where: { kind: "ANGEBOT", status: "OFFEN" }, _sum: { netCents: true }, _count: true }),
    db.salesDoc.findMany({ where: { status: "ENTWURF" }, orderBy: { updatedAt: "desc" }, take: 8, include: { customer: { select: { name: true } } } }),
    db.salesDoc.findMany({ where: { status: { not: "ENTWURF" } }, orderBy: { finalizedAt: "desc" }, take: 8, include: { customer: { select: { name: true } } } }),
    db.customer.count({ where: { archived: false } }),
    purchaseTotals(monthStart, today),
    db.bankTx.count({ where: { docId: null, purchaseId: null, ignored: false } }),
    unbookedReceiptsWhere().then((w) => db.storedFile.count({ where: w })),
  ]);
  const missing = missingForInvoices(cfg);

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="page-title">Buchhaltung</h1>
          <p className="mt-1 text-sm text-steel">Angebote, Rechnungen als E-Rechnung, Zahlungen und Mahnungen – direkt in Jarvis.</p>
        </div>
        <form action={newDocAction.bind(null, "ANGEBOT", {})}><button className="btn-secondary"><FilePlus2 className="size-4" /> Angebot</button></form>
        <form action={newDocAction.bind(null, "RECHNUNG", {})}><button className="btn-primary"><FilePlus2 className="size-4" /> Rechnung</button></form>
      </div>

      {missing.length > 0 && (
        <p className="card flex flex-wrap items-center gap-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" /> Für Rechnungen fehlt noch: <strong>{missing.join(", ")}</strong>.
          {user.role === "ADMIN" ? <Link href="/buchhaltung/einstellungen" className="btn-primary ml-auto"><Settings className="size-4" /> Einstellungen</Link> : " Ein Administrator trägt das unter Buchhaltung → Einstellungen ein."}
        </p>
      )}
      {customers === 0 && user.role === "ADMIN" && (
        <p className="card p-4 text-sm">Noch keine Kunden. Du kannst <Link href="/buchhaltung/einstellungen#lexware" className="font-semibold text-brand">Kunden, Artikel und offene Rechnungen aus Lexware übernehmen</Link> oder <Link href="/buchhaltung/kunden/neu" className="font-semibold text-brand">einen Kunden anlegen</Link>.</p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/buchhaltung/belege?art=rechnungen&status=offen" className="card p-4 hover:border-brand"><p className="text-xs text-steel">Offene Rechnungen</p><p className="text-xl font-semibold sm:text-2xl">{fmtEuroCents(open.openCents)}</p><p className="text-xs text-steel">{open.list.length} Stück</p></Link>
        <Link href="/buchhaltung/belege?art=rechnungen&status=ueberfaellig" className="card p-4 hover:border-brand"><p className="text-xs text-steel">Überfällig</p><p className={`text-xl font-semibold sm:text-2xl ${open.overdueCents ? "text-bad" : ""}`}>{fmtEuroCents(open.overdueCents)}</p><p className="text-xs text-steel">{open.overdue.length} Stück</p></Link>
        <div className="card p-4"><p className="text-xs text-steel">Umsatz {new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date())} (netto)</p><p className="text-xl font-semibold sm:text-2xl">{fmtEuroCents(month.netCents)}</p><p className="text-xs text-steel">Jahr {p.y}: {fmtEuroCents(year.netCents)}</p></div>
        <Link href="/buchhaltung/belege?art=angebote&status=offen" className="card p-4 hover:border-brand"><p className="text-xs text-steel">Offene Angebote (netto)</p><p className="text-xl font-semibold sm:text-2xl">{fmtEuroCents(quotes._sum.netCents)}</p><p className="text-xs text-steel">{quotes._count} Stück</p></Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link href="/buchhaltung/ausgaben" className="card flex items-center gap-3 p-4 hover:border-brand">
          <Wallet className="size-5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1"><span className="block text-xs text-steel">Ausgaben {new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date())} (netto)</span><span className="text-lg font-semibold">{fmtEuroCents(costs.netCents)}</span></span>
          {photos > 0 && <span className="chip border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">{photos} Beleg{photos === 1 ? "" : "e"} zu buchen</span>}
        </Link>
        <Link href="/buchhaltung/bank" className="card flex items-center gap-3 p-4 hover:border-brand">
          <Landmark className="size-5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1"><span className="block text-xs text-steel">Bankabgleich</span><span className="text-lg font-semibold">{bankOpen ? `${bankOpen} Umsätze offen` : "Alles zugeordnet"}</span></span>
          <span className="text-xs text-steel">Kontoauszug hochladen</span>
        </Link>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-bad" /> Überfällige Rechnungen</h2>
          {open.overdue.length === 0 ? <p className="mt-2 text-sm text-steel">Keine – alles im grünen Bereich.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {open.overdue.slice(0, 10).map((d) => (
                <li key={d.id}><Link href={`/buchhaltung/beleg/${d.id}`} className="flex gap-2 py-2 hover:text-brand"><span className="min-w-0 flex-1 truncate"><strong>{d.number}</strong> · {customerName(d)}</span><span className="text-xs text-bad">fällig {formatDate(d.dueDate)}</span><span className="font-semibold">{fmtEuroCents(openCentsOf(d))}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-brand" /> Entwürfe</h2>
          {drafts.length === 0 ? <p className="mt-2 text-sm text-steel">Keine offenen Entwürfe.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {drafts.map((d) => <li key={d.id}><Link href={`/buchhaltung/beleg/${d.id}`} className="flex gap-2 py-2 hover:text-brand"><span className="min-w-0 flex-1 truncate">{docLabel(d)} · {customerName(d)}{d.title ? ` · ${d.title}` : ""}</span><span className="font-semibold">{fmtEuroCents(d.grossCents)}</span></Link></li>)}
            </ul>
          )}
        </section>
        <section className="card p-4 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold"><Receipt className="size-4 text-brand" /> Zuletzt festgeschrieben</h2>
          {recent.length === 0 ? <p className="mt-2 text-sm text-steel">Noch nichts.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {recent.map((d) => <li key={d.id}><Link href={`/buchhaltung/beleg/${d.id}`} className="flex gap-2 py-2 hover:text-brand"><span className="w-32 shrink-0 font-semibold">{d.number}</span><span className="min-w-0 flex-1 truncate">{docLabel(d)} · {customerName(d)}</span><span className="text-steel">{formatDate(d.date)}</span><span className="w-24 text-right font-semibold">{fmtEuroCents(d.grossCents)}</span></Link></li>)}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
