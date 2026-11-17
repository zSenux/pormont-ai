import Link from "next/link";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, Check, Landmark, Paperclip } from "lucide-react";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { addDaysYmd, berlinDateTime, formatDate, todayYmd } from "@/lib/berlin";
import { customerName, openCentsOf, payableCents, ymdOf } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { purchaseDueYmd } from "@/lib/buchhaltung/purchases";
import { docLabel } from "@/lib/buchhaltung/types";
import { payInvoiceAction, setPurchasePaidAction } from "@/app/actions/offene-posten";
import { ResultButton } from "../beleg/[id]/panels";

export const metadata = { title: "Offene Posten" };
export const dynamic = "force-dynamic";

const SHOW = { offen: "Offen", bezahlt: "Bezahlt (90 Tage)" } as const;

/** Tage überfällig (positiv) bzw. bis zur Fälligkeit (negativ), null ohne Fälligkeit */
function lateDays(due: Date | null, today: string) {
  const d = ymdOf(due);
  if (!d) return null;
  return Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
}

function DueBadge({ due, today }: { due: Date | null; today: string }) {
  const n = lateDays(due, today);
  if (n === null) return <span className="text-xs text-steel">ohne Fälligkeit</span>;
  if (n > 0) return <span className="chip border-bad/30 bg-red-50 px-2 py-0.5 text-xs text-bad">{n} {n === 1 ? "Tag" : "Tage"} überfällig</span>;
  if (n === 0) return <span className="chip border-warn/30 bg-amber-50 px-2 py-0.5 text-xs text-warn">heute fällig</span>;
  return <span className="text-xs text-steel">fällig {formatDate(due)}</span>;
}

export default async function OffenePosten({ searchParams }: { searchParams: Promise<{ zeige?: string; filter?: string }> }) {
  await requireArea("buchhaltung");
  const sp = await searchParams;
  const show = (sp.zeige && sp.zeige in SHOW ? sp.zeige : "offen") as keyof typeof SHOW;
  // „Überfällig“ (Knopf auf der Übersicht): nur offene Posten, deren Fälligkeit vorbei ist
  const late = show === "offen" && sp.filter === "ueberfaellig";
  const today = todayYmd();
  const since = berlinDateTime(addDaysYmd(today, -90));
  const [docs, purchasesAll, openDocAll, openPurAll] = await Promise.all([
    db.salesDoc.findMany({
      where: show === "offen" ? { kind: "RECHNUNG", status: "OFFEN", ...(late ? { dueDate: { lt: berlinDateTime(today) } } : {}) } : { kind: "RECHNUNG", status: "BEZAHLT", updatedAt: { gte: since } },
      orderBy: show === "offen" ? [{ dueDate: "asc" }, { date: "asc" }] : [{ updatedAt: "desc" }],
      take: 300,
      include: { customer: { select: { name: true } }, payments: { orderBy: { day: "desc" }, take: 1, select: { day: true } } },
    }),
    db.purchaseDoc.findMany({
      where: show === "offen" ? { status: "OFFEN" } : { status: "BEZAHLT", paidAt: { gte: since } },
      orderBy: show === "offen" ? [{ dueDate: "asc" }, { date: "asc" }] : [{ paidAt: "desc" }],
      take: 300,
    }),
    db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN" }, select: { grossCents: true, prepaidCents: true, paidCents: true, dueDate: true } }),
    db.purchaseDoc.findMany({ where: { status: "OFFEN" }, select: { grossCents: true, dueDate: true, date: true } }),
  ]);
  const purchases = late ? purchasesAll.filter((p) => purchaseDueYmd(p) < today) : purchasesAll;
  const bankLinked = new Set(
    (await db.bankTx.findMany({ where: { OR: [{ docId: { in: docs.map((d) => d.id) } }, { purchaseId: { in: purchases.map((p) => p.id) } }] }, select: { docId: true, purchaseId: true } })).flatMap((t) => [t.docId, t.purchaseId]).filter(Boolean) as string[],
  );

  const recv = openDocAll.reduce((s, d) => s + openCentsOf(d), 0);
  const recvLate = openDocAll.filter((d) => (lateDays(d.dueDate, today) ?? 0) > 0).reduce((s, d) => s + openCentsOf(d), 0);
  // Ausgaben ohne Fälligkeit: Datum + 14 Tage (wie in der Liquidität)
  const purDue = (p: { dueDate: Date | null; date: Date }) => berlinDateTime(purchaseDueYmd(p));
  const pay = openPurAll.reduce((s, p) => s + p.grossCents, 0);
  const payLate = openPurAll.filter((p) => (lateDays(purDue(p), today) ?? 0) > 0).reduce((s, p) => s + p.grossCents, 0);

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="page-title">Offene Posten</h1>
          <p className="text-sm text-steel">Rechnungsausgang und Rechnungseingang auf einen Blick – was bezahlt ist und was offen ist. Zahlungen kommen aus dem Bankabgleich oder per Klick.</p>
        </div>
        <nav className="flex gap-2">
          {(Object.keys(SHOW) as (keyof typeof SHOW)[]).map((k) => (
            <Link key={k} href={`/buchhaltung/offene-posten?zeige=${k}`} className={clsx("chip px-3 py-1", show === k && !late ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{SHOW[k]}</Link>
          ))}
          <Link href="/buchhaltung/offene-posten?filter=ueberfaellig" className={clsx("chip px-3 py-1", late ? "border-bad bg-bad text-white" : "bg-white text-bad")}>Überfällig</Link>
        </nav>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <p className="flex items-center gap-2 text-sm text-steel"><ArrowDownLeft className="size-4 text-ok" /> Forderungen (Kunden schulden uns)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{fmtEuroCents(recv)}</p>
          <p className="text-sm text-steel">{openDocAll.length} offene Rechnungen{recvLate ? <> · <span className="text-bad">{fmtEuroCents(recvLate)} überfällig</span></> : ""}</p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-2 text-sm text-steel"><ArrowUpRight className="size-4 text-bad" /> Verbindlichkeiten (wir schulden)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{fmtEuroCents(pay)}</p>
          <p className="text-sm text-steel">{openPurAll.length} offene Eingangsrechnungen{payLate ? <> · <span className="text-bad">{fmtEuroCents(payLate)} überfällig</span></> : ""}</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section id="ausgang" className="card scroll-mt-24">
          <h2 className="flex items-center gap-2 border-b border-line p-4 font-semibold"><ArrowDownLeft className="size-4 text-ok" /> {late ? "Überfällig – Kunde nicht bezahlt" : "Rechnungsausgang"} <span className="font-normal text-steel">({docs.length})</span></h2>
          {docs.length === 0 && <p className="p-4 text-sm text-steel">{late ? "Kein Kunde ist mit einer Zahlung im Verzug. 🎉" : show === "offen" ? "Keine offenen Rechnungen – alles bezahlt." : "Keine bezahlten Rechnungen in den letzten 90 Tagen."}</p>}
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <Link href={`/buchhaltung/beleg/${d.id}`} className="min-w-0 flex-1">
                  <p className="font-medium"><span className="text-brand">{d.number}</span> · {customerName(d)}</p>
                  <p className="text-xs text-steel">{docLabel(d)} vom {formatDate(d.date)}{d.paidCents > 0 && d.status === "OFFEN" ? ` · ${fmtEuroCents(d.paidCents)} von ${fmtEuroCents(payableCents(d))} bezahlt` : ""}{d.reverseCharge ? " · § 13b netto" : ""}</p>
                </Link>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{fmtEuroCents(d.status === "OFFEN" ? openCentsOf(d) : payableCents(d))}</span>
                  {d.status === "OFFEN" ? <DueBadge due={d.dueDate} today={today} /> : <span className="chip border-ok/30 bg-ok/10 px-2 py-0.5 text-xs text-ok"><Check className="size-3" /> bezahlt {d.payments[0] ? formatDate(d.payments[0].day) : ""}</span>}
                </div>
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                  {bankLinked.has(d.id) && <span title="Mit Kontoauszug verknüpft" className="text-steel"><Landmark className="size-4" /></span>}
                  {d.status === "OFFEN" && <ResultButton action={payInvoiceAction.bind(null, d.id)} confirm={`${d.number}: ${fmtEuroCents(openCentsOf(d))} heute als bezahlt buchen?`} className="btn-secondary px-3 py-1 text-xs">Bezahlt</ResultButton>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="eingang" className="card scroll-mt-24">
          <h2 className="flex items-center gap-2 border-b border-line p-4 font-semibold"><ArrowUpRight className="size-4 text-bad" /> {late ? "Überfällig – wir müssen zahlen" : "Rechnungen zu bezahlen"} <span className="font-normal text-steel">({purchases.length})</span></h2>
          {purchases.length === 0 && <p className="p-4 text-sm text-steel">{late ? "Keine überfälligen Eingangsrechnungen." : show === "offen" ? "Keine offenen Eingangsrechnungen." : "Keine bezahlten Eingangsrechnungen in den letzten 90 Tagen."}</p>}
          <ul className="divide-y divide-line">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <Link href={`/buchhaltung/ausgaben/${p.id}`} className="min-w-0 flex-1">
                  <p className="font-medium"><span className="text-brand">{p.number}</span> · {p.supplier}</p>
                  <p className="text-xs text-steel">{p.docNo ? `Re.-Nr. ${p.docNo} · ` : ""}vom {formatDate(p.date)}</p>
                </Link>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{fmtEuroCents(p.grossCents)}</span>
                  {p.status === "OFFEN" ? <DueBadge due={purDue(p)} today={today} /> : <span className="chip border-ok/30 bg-ok/10 px-2 py-0.5 text-xs text-ok"><Check className="size-3" /> bezahlt {formatDate(p.paidAt)}</span>}
                </div>
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                  {p.fileId && <span title="Beleg hinterlegt" className="text-steel"><Paperclip className="size-4" /></span>}
                  {bankLinked.has(p.id) && <span title="Mit Kontoauszug verknüpft" className="text-steel"><Landmark className="size-4" /></span>}
                  {p.status === "OFFEN" ? (
                    <ResultButton action={setPurchasePaidAction.bind(null, p.id, true)} className="btn-secondary px-3 py-1 text-xs">Bezahlt</ResultButton>
                  ) : (
                    !bankLinked.has(p.id) && <ResultButton action={setPurchasePaidAction.bind(null, p.id, false)} className="px-2 py-1 text-xs text-steel">wieder offen</ResultButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-xs text-steel">Teilzahlungen, Skonto oder eine andere Zahlart trägst du direkt in der Rechnung ein (Klick auf die Nummer). Zahlungen aus dem Kontoauszug ordnest du im <Link href="/buchhaltung/bank" className="text-brand">Bankabgleich</Link> zu.</p>
    </main>
  );
}
