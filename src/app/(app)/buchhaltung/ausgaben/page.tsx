import Link from "next/link";
import { Camera, Plus } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, formatDate, todayYmd } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { PURCHASE_CATEGORIES, purchaseTotals, unbookedReceiptsWhere } from "@/lib/buchhaltung/purchases";
import { receiptSummary, receiptData } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausgaben" };

export default async function AusgabenPage({ searchParams }: { searchParams: Promise<{ monat?: string; status?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : todayYmd().slice(0, 7);
  const status = sp.status === "offen" ? "OFFEN" : sp.status === "bezahlt" ? "BEZAHLT" : null;
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const [list, totals, photos] = await Promise.all([
    db.purchaseDoc.findMany({ where: { date: { gte: berlinDateTime(from), lte: berlinDateTime(to) }, ...(status ? { status } : {}) }, orderBy: [{ date: "desc" }, { number: "desc" }], include: { project: { select: { name: true } } } }),
    purchaseTotals(from, to),
    db.storedFile.findMany({ where: await unbookedReceiptsWhere(), orderBy: { createdAt: "desc" }, take: 30, select: { id: true, meta: true, createdAt: true } }),
  ]);
  const unbooked = photos;
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  const href = (o: { monat?: string; status?: string | null }) => `/buchhaltung/ausgaben?monat=${o.monat ?? month}${(o.status === undefined ? sp.status : o.status) ? `&status=${o.status === undefined ? sp.status : o.status}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Ausgaben</h1>
        <div className="flex gap-2">
          <Link href="/belege/foto" className="btn-secondary"><Camera className="size-4" /> Beleg fotografieren</Link>
          <Link href="/buchhaltung/ausgaben/neu" className="btn-primary"><Plus className="size-4" /> Ausgabe erfassen</Link>
        </div>
      </div>

      {unbooked.length > 0 && (
        <section className="card border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">{unbooked.length} fotografierte {unbooked.length === 1 ? "Beleg wartet" : "Belege warten"} aufs Buchen</h2>
          <ul className="mt-2 divide-y divide-amber-200 text-sm">
            {unbooked.slice(0, 8).map((p) => {
              const d = receiptData.safeParse(p.meta);
              return (
                <li key={p.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{receiptSummary(d.success ? d.data : null)}</span>
                  <Link href={`/buchhaltung/ausgaben/neu?foto=${p.id}`} className="btn-secondary px-3 py-1 text-xs">Buchen</Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ monat: prev })} className="btn-secondary px-3 py-1.5" aria-label="Vormonat">‹</Link>
        <span className="min-w-36 text-center font-semibold">{monthLabel}</span>
        <Link href={href({ monat: next })} className="btn-secondary px-3 py-1.5" aria-label="Nächster Monat">›</Link>
        <span className="mx-2 h-6 w-px bg-line" />
        {[[null, "Alle"], ["offen", "Offen"], ["bezahlt", "Bezahlt"]].map(([k, l]) => (
          <Link key={l} href={href({ status: k })} className={clsx("chip px-3 py-1", (sp.status ?? null) === k ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{l}</Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-xs text-steel">Ausgaben netto im {monthLabel.split(" ")[0]}</p><p className="text-xl font-semibold">{fmtEuroCents(totals.netCents)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Vorsteuer</p><p className="text-xl font-semibold">{fmtEuroCents(totals.taxCents)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Noch zu bezahlen (alle Monate)</p><p className="text-xl font-semibold text-warn">{fmtEuroCents(totals.openCents)}</p><p className="text-[11px] text-steel">{totals.openCount} offene Rechnungen</p></div>
      </div>

      <section className="card divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-steel">Keine Ausgaben in diesem Monat.</p>}
        {list.map((p) => (
          <Link key={p.id} href={`/buchhaltung/ausgaben/${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm hover:bg-mist/50">
            <span className="w-24 shrink-0 font-semibold">{p.number}</span>
            <span className="min-w-0 flex-1 truncate"><strong>{p.supplier}</strong><span className="text-steel"> · {PURCHASE_CATEGORIES[p.category as keyof typeof PURCHASE_CATEGORIES]?.split(" (")[0] ?? p.category}{p.project ? ` · ${p.project.name}` : ""}</span></span>
            <span className="text-xs text-steel">{formatDate(p.date)}</span>
            <span className="w-24 text-right font-semibold">{fmtEuroCents(p.grossCents)}</span>
            <span className={clsx("chip w-20 justify-center", p.status === "BEZAHLT" ? "border-emerald-200 bg-emerald-50 text-ok" : "border-amber-200 bg-amber-50 text-warn")}>{p.status === "BEZAHLT" ? "bezahlt" : "offen"}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
