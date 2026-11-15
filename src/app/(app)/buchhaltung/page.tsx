import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Camera, FilePlus2, FileText, Landmark, Plus, Receipt, Settings, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { bookConfig, missingForInvoices } from "@/lib/buchhaltung/config";
import { customerName, isOverdue, openInvoices, revenue, openCentsOf } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { docLabel } from "@/lib/buchhaltung/types";
import { PURCHASE_CATEGORIES, purchaseTotals, unbookedReceiptsWhere } from "@/lib/buchhaltung/purchases";
import { newDocAction } from "@/app/actions/buchhaltung";

export const metadata = { title: "Buchhaltung" };
export const dynamic = "force-dynamic";

export default async function BuchhaltungPage() {
  const user = await requireUser();
  const today = todayYmd();
  const p = berlinParts();
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${p.y}-01-01`;
  const [cfg, open, month, year, quotes, drafts, recent, customers, costs, bankOpen, photos, yearCosts, inList, outList] = await Promise.all([
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
    purchaseTotals(yearStart, today),
    // Einnahmen = Ausgangsrechnungen, Ausgaben = Eingangsrechnungen/Kassenbons (neueste zuerst)
    db.salesDoc.findMany({ where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 6, include: { customer: { select: { name: true } } } }),
    db.purchaseDoc.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6 }),
  ]);
  const monthName = new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date());
  const result = month.netCents - costs.netCents;
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

      {/* Auf einen Blick: Rechnungen Einnahme und Ausgabe, bevor man ins Rechnungswesen geht */}
      <section className="grid gap-3 lg:grid-cols-2" aria-label="Einnahmen und Ausgaben">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-emerald-50/60 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white"><ArrowDownLeft className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Rechnungen Einnahme</h2>
              <p className="text-xs text-steel">{monthName}: <strong className="text-ink">{fmtEuroCents(month.netCents)}</strong> netto · Jahr {fmtEuroCents(year.netCents)} · offen {fmtEuroCents(open.openCents)}</p>
            </div>
            <form action={newDocAction.bind(null, "RECHNUNG", {})}><button className="btn-secondary px-2.5 py-1.5 text-xs" title="Neue Rechnung"><Plus className="size-4" /><span className="hidden sm:inline">Rechnung</span></button></form>
          </div>
          {inList.length === 0 ? <p className="p-4 text-sm text-steel">Noch keine Rechnungen festgeschrieben.</p> : (
            <ul className="divide-y divide-line text-sm">
              {inList.map((d) => {
                const paid = d.status === "BEZAHLT";
                return (
                  <li key={d.id}><Link href={`/buchhaltung/beleg/${d.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-mist">
                    <span className="w-28 shrink-0 font-semibold">{d.number}</span>
                    <span className="min-w-0 flex-1 truncate">{customerName(d)}</span>
                    <span className={`chip hidden px-2 py-0.5 sm:inline-flex ${paid ? "border-emerald-300 bg-emerald-50 text-emerald-800" : d.kind === "GUTSCHRIFT" ? "border-line bg-white text-steel" : isOverdue(d) ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>{d.kind === "GUTSCHRIFT" ? "Gutschrift" : paid ? "bezahlt" : isOverdue(d) ? "überfällig" : "offen"}</span>
                    <span className="w-24 shrink-0 text-right font-semibold">{d.kind === "GUTSCHRIFT" ? "− " : ""}{fmtEuroCents(d.grossCents)}</span>
                  </Link></li>
                );
              })}
            </ul>
          )}
          <Link href="/buchhaltung/belege?art=rechnungen" className="block border-t border-line px-4 py-2 text-sm font-medium text-brand hover:bg-mist">Alle Rechnungen →</Link>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-red-50/50 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bad text-white"><ArrowUpRight className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Rechnungen Ausgabe</h2>
              <p className="text-xs text-steel">{monthName}: <strong className="text-ink">{fmtEuroCents(costs.netCents)}</strong> netto · Jahr {fmtEuroCents(yearCosts.netCents)} · offen {fmtEuroCents(costs.openCents)}</p>
            </div>
            <Link href="/buchhaltung/ausgaben/neu" className="btn-secondary px-2.5 py-1.5 text-xs" title="Ausgabe erfassen"><Camera className="size-4" /><span className="hidden sm:inline">Erfassen</span></Link>
          </div>
          {photos > 0 && <Link href="/buchhaltung/ausgaben" className="block border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">{photos} fotografierte{photos === 1 ? "r" : ""} Beleg{photos === 1 ? "" : "e"} noch zu buchen →</Link>}
          {outList.length === 0 ? <p className="p-4 text-sm text-steel">Noch keine Ausgaben erfasst.</p> : (
            <ul className="divide-y divide-line text-sm">
              {outList.map((x) => (
                <li key={x.id}><Link href={`/buchhaltung/ausgaben/${x.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-mist">
                  <span className="w-28 shrink-0 font-semibold">{x.number}</span>
                  <span className="min-w-0 flex-1 truncate">{x.supplier}<span className="hidden text-steel sm:inline"> · {(PURCHASE_CATEGORIES[x.category as keyof typeof PURCHASE_CATEGORIES] ?? x.category).split(" (")[0]}</span></span>
                  <span className={`chip hidden px-2 py-0.5 sm:inline-flex ${x.status === "BEZAHLT" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>{x.status === "BEZAHLT" ? "bezahlt" : "offen"}</span>
                  <span className="w-24 shrink-0 text-right font-semibold">{fmtEuroCents(x.grossCents)}</span>
                </Link></li>
              ))}
            </ul>
          )}
          <Link href="/buchhaltung/ausgaben" className="block border-t border-line px-4 py-2 text-sm font-medium text-brand hover:bg-mist">Alle Ausgaben →</Link>
        </div>
        <p className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm lg:col-span-2">
          <span className="text-steel">Ergebnis {monthName} (netto, Einnahmen − Ausgaben)</span>
          <strong className={`text-lg ${result < 0 ? "text-bad" : "text-ok"}`}>{fmtEuroCents(result)}</strong>
          <span className="text-steel">Jahr {p.y}: <strong className={year.netCents - yearCosts.netCents < 0 ? "text-bad" : "text-ink"}>{fmtEuroCents(year.netCents - yearCosts.netCents)}</strong></span>
          <span className="text-xs text-steel sm:ml-auto">ohne Lohn, Spesen und Abschreibungen – grober Überblick, kein Abschluss</span>
        </p>
      </section>

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
