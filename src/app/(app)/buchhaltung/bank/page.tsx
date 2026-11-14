import Link from "next/link";
import { clsx } from "clsx";
import { Check, Landmark } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { openCentsOf } from "@/lib/buchhaltung/docs";
import { suggestions } from "@/lib/buchhaltung/bank";
import { assignTxAction, ignoreTxAction, unassignTxAction } from "@/app/actions/bank";
import { ResultButton } from "../beleg/[id]/panels";
import { AutoButton, ManualAssign, UploadForm } from "./parts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bankabgleich" };

const FILTER = { offen: "Offen", zugeordnet: "Zugeordnet", ignoriert: "Ignoriert" } as const;

export default async function BankPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const f = (sp.f && sp.f in FILTER ? sp.f : "offen") as keyof typeof FILTER;
  const where = f === "offen" ? { docId: null, purchaseId: null, ignored: false } : f === "ignoriert" ? { ignored: true } : { OR: [{ docId: { not: null } }, { purchaseId: { not: null } }] };
  const [txs, counts, openDocs, openPurchases] = await Promise.all([
    db.bankTx.findMany({ where, orderBy: [{ day: "desc" }, { createdAt: "desc" }], take: 300 }),
    Promise.all([db.bankTx.count({ where: { docId: null, purchaseId: null, ignored: false } }), db.bankTx.count({ where: { OR: [{ docId: { not: null } }, { purchaseId: { not: null } }] } }), db.bankTx.count({ where: { ignored: true } })]),
    db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN" }, orderBy: { date: "asc" }, include: { customer: { select: { name: true } } } }),
    db.purchaseDoc.findMany({ where: { status: "OFFEN" }, orderBy: { date: "asc" } }),
  ]);
  const sug = f === "offen" ? await suggestions(txs) : new Map();
  const docOpts = openDocs.map((d) => ({ kind: "doc" as const, id: d.id, label: `${d.number} · ${d.customer?.name ?? ""} · ${fmtEuroCents(openCentsOf(d))}` }));
  const purOpts = openPurchases.map((p) => ({ kind: "purchase" as const, id: p.id, label: `${p.number} · ${p.supplier} · ${fmtEuroCents(p.grossCents)}` }));
  const linked = f === "zugeordnet"
    ? new Map([
        ...(await db.salesDoc.findMany({ where: { id: { in: txs.map((t) => t.docId).filter((x): x is string => !!x) } }, select: { id: true, number: true } })).map((d) => [d.id, d.number ?? ""] as const),
        ...(await db.purchaseDoc.findMany({ where: { id: { in: txs.map((t) => t.purchaseId).filter((x): x is string => !!x) } }, select: { id: true, number: true } })).map((p) => [p.id, p.number] as const),
      ])
    : new Map<string, string>();
  const sure = [...sug.values()].filter((s) => s.sure).length;

  return (
    <div className="space-y-4">
      <h1 className="page-title">Bankabgleich</h1>

      <section className="card grid gap-4 p-4 md:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Landmark className="size-4 text-brand" /> Kontoauszug hochladen</h2>
          <p className="mt-1 text-sm text-steel">Im Online-Banking den Auszug als <b>CAMT (XML)</b> oder <b>CSV</b> herunterladen und hier einlesen. Doppelte Umsätze werden erkannt. Jarvis sucht dann die passende Rechnung (Rechnungsnummer im Verwendungszweck oder gleicher Betrag) bzw. Ausgabe.</p>
        </div>
        <UploadForm />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER) as (keyof typeof FILTER)[]).map((k, i) => (
          <Link key={k} href={`/buchhaltung/bank?f=${k}`} className={clsx("chip px-3 py-1", f === k ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{FILTER[k]} ({counts[i]})</Link>
        ))}
        {f === "offen" && sure > 0 && <span className="ml-auto"><AutoButton /></span>}
      </div>

      <section className="card divide-y divide-line">
        {txs.length === 0 && <p className="p-5 text-sm text-steel">{f === "offen" ? "Keine offenen Umsätze – alles zugeordnet." : "Keine Umsätze."}</p>}
        {txs.map((t) => {
          const s = sug.get(t.id);
          const target = t.docId ? { href: `/buchhaltung/beleg/${t.docId}`, no: linked.get(t.docId) } : t.purchaseId ? { href: `/buchhaltung/ausgaben/${t.purchaseId}`, no: linked.get(t.purchaseId) } : null;
          return (
            <div key={t.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3 text-sm">
              <span className="w-20 shrink-0 text-steel">{formatDate(t.day)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name ?? "—"}</p>
                {t.purpose && <p className="line-clamp-2 text-xs text-steel">{t.purpose}</p>}
              </div>
              <span className={clsx("w-28 shrink-0 text-right font-semibold tabular-nums", t.amountCents > 0 ? "text-ok" : "text-ink")}>{t.amountCents > 0 ? "+" : ""}{fmtEuroCents(t.amountCents)}</span>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:min-w-72">
                {target && (
                  <>
                    <Link href={target.href} className="chip border-ok/40 bg-ok/10 px-2 py-0.5 text-ok"><Check className="size-3.5" /> {target.no ?? "zugeordnet"}</Link>
                    <ResultButton action={unassignTxAction.bind(null, t.id)} confirm="Zuordnung lösen? Die erfasste Zahlung wird wieder entfernt." className="btn-secondary px-3 py-1 text-xs">Lösen</ResultButton>
                  </>
                )}
                {t.ignored && <ResultButton action={ignoreTxAction.bind(null, t.id, false)} className="btn-secondary px-3 py-1 text-xs">Wieder offen</ResultButton>}
                {f === "offen" && (
                  <>
                    {s && (
                      <span className={clsx("flex items-center gap-2 rounded-lg border px-2 py-1 text-xs", s.sure ? "border-ok/40 bg-ok/5" : "border-amber-300 bg-amber-50")}>
                        <span className="max-w-56 truncate">{s.sure ? "Treffer" : "Vielleicht"}: {s.label}</span>
                        <ResultButton action={assignTxAction.bind(null, t.id, s.kind, s.id)} className="btn-primary px-2.5 py-0.5 text-xs">Übernehmen</ResultButton>
                      </span>
                    )}
                    <ManualAssign txId={t.id} options={t.amountCents > 0 ? docOpts : purOpts} />
                    <ResultButton action={ignoreTxAction.bind(null, t.id, true)} className="px-2 py-1 text-xs text-steel hover:text-ink">Ignorieren</ResultButton>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <p className="text-xs text-steel">Zahlungseingänge werden als Zahlung an der Rechnung erfasst, Zahlungsausgänge markieren die Ausgabe als bezahlt. Privat- und Gehaltsbuchungen einfach ignorieren.</p>
    </div>
  );
}
