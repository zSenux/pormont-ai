import Link from "next/link";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Download, FileText, FolderArchive, Landmark, TriangleAlert } from "lucide-react";
import { requireArea } from "@/lib/rights";
import { formatDate, todayYmd } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { ablageMonth, ablageYear, isMonth, MONTHS, monthLabel } from "@/lib/buchhaltung/ablage";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { docLabel } from "@/lib/buchhaltung/types";
import { PURCHASE_CATEGORIES } from "@/lib/buchhaltung/purchases";

export const metadata = { title: "Ablage Buchhaltung" };
export const dynamic = "force-dynamic";

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return t.toISOString().slice(0, 7);
};

export default async function Ablage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  await requireArea("buchhaltung");
  const sp = await searchParams;
  const now = todayYmd().slice(0, 7);
  const month = isMonth(sp.monat) ? sp.monat : now;
  const year = Number(month.slice(0, 4));
  const [{ out, inc, statements }, months] = await Promise.all([ablageMonth(month), ablageYear(year)]);
  const missing = inc.filter((p) => !p.fileId).length;
  const outSum = out.reduce((s, d) => s + (d.kind === "GUTSCHRIFT" ? -d.grossCents : d.grossCents), 0);
  const incSum = inc.reduce((s, p) => s + p.grossCents, 0);
  const catLabel = (k: string) => (PURCHASE_CATEGORIES as Record<string, string>)[k] ?? k;

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="page-title flex items-center gap-2"><FolderArchive className="size-6 text-brand" /> Ablage Buchhaltung</h1>
          <p className="text-sm text-steel">Alles eines Monats an einem Ort: Ausgangsrechnungen, Eingangsbelege und Kontoauszüge – zum Nachschlagen und als ZIP für den Steuerberater.</p>
        </div>
        <a href={`/api/buchhaltung/ablage?monat=${month}`} className="btn-primary"><Download className="size-4" /> {monthLabel(month)} als ZIP</a>
      </div>

      <section className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <Link href={`/buchhaltung/ablage?monat=${year - 1}-12`} className="rounded-lg p-1 text-steel hover:bg-mist" aria-label="Vorjahr"><ChevronLeft className="size-5" /></Link>
          <span className="font-semibold">{year}</span>
          <Link href={`/buchhaltung/ablage?monat=${year + 1}-01`} className={clsx("rounded-lg p-1 text-steel hover:bg-mist", `${year + 1}-01` > now && "pointer-events-none opacity-30")} aria-label="Folgejahr"><ChevronRight className="size-5" /></Link>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
          {months.map((m, i) => {
            const future = m.month > now;
            const empty = !m.out && !m.inc && !m.statements;
            return (
              <Link key={m.month} href={`/buchhaltung/ablage?monat=${m.month}`} className={clsx("rounded-xl border px-2 py-1.5 text-center text-xs transition", m.month === month ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand", future && "pointer-events-none opacity-40")}>
                <span className="block font-semibold">{MONTHS[i].slice(0, 3)}</span>
                <span className={clsx(m.month === month ? "text-white/80" : "text-steel")}>{empty ? "–" : `${m.out + m.inc + m.statements} Dok.`}</span>
                {!future && m.inc > 0 && m.statements === 0 && <span className={clsx("block", m.month === month ? "text-white" : "text-warn")}>Auszug fehlt</span>}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-2">
        <Link href={`/buchhaltung/ablage?monat=${shift(month, -1)}`} className="btn-secondary px-2 py-1" aria-label="Vormonat"><ChevronLeft className="size-4" /></Link>
        <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
        {shift(month, 1) <= now && <Link href={`/buchhaltung/ablage?monat=${shift(month, 1)}`} className="btn-secondary px-2 py-1" aria-label="Folgemonat"><ChevronRight className="size-4" /></Link>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card">
          <h3 className="flex items-center gap-2 border-b border-line p-4 font-semibold"><ArrowDownLeft className="size-4 text-ok" /> Ausgangsrechnungen <span className="ml-auto text-sm font-normal text-steel">{out.length} · {fmtEuroCents(outSum)}</span></h3>
          {out.length === 0 && <p className="p-4 text-sm text-steel">Keine Rechnungen in diesem Monat.</p>}
          <ul className="divide-y divide-line text-sm">
            {out.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-steel" />
                <a href={`/api/buchhaltung/pdf/${d.id}`} target="_blank" className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-brand">{d.number}</span>
                  <span className="block truncate text-xs text-steel">{docLabel(d)} · {formatDate(d.date)} · {d.customer?.name ?? "–"}</span>
                </a>
                <span className="text-right tabular-nums">{d.kind === "GUTSCHRIFT" ? "−" : ""}{fmtEuroCents(d.grossCents)}<span className={clsx("block text-xs", d.status === "BEZAHLT" ? "text-ok" : d.status === "STORNIERT" ? "text-steel" : "text-warn")}>{d.status === "BEZAHLT" ? "bezahlt" : d.status === "STORNIERT" ? "storniert" : d.kind === "GUTSCHRIFT" ? "" : "offen"}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3 className="flex items-center gap-2 border-b border-line p-4 font-semibold"><ArrowUpRight className="size-4 text-bad" /> Eingangsbelege <span className="ml-auto text-sm font-normal text-steel">{inc.length} · {fmtEuroCents(incSum)}</span></h3>
          {missing > 0 && <p className="flex items-center gap-1.5 border-b border-line bg-amber-50 px-4 py-2 text-xs text-warn"><TriangleAlert className="size-3.5" /> {missing} ohne Belegdatei – bitte nachreichen</p>}
          {inc.length === 0 && <p className="p-4 text-sm text-steel">Keine Ausgaben in diesem Monat.</p>}
          <ul className="divide-y divide-line text-sm">
            {inc.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
                <FileText className={clsx("size-4 shrink-0", p.fileId ? "text-steel" : "text-warn")} />
                {p.fileId ? (
                  <a href={fileUrl(p.fileId)} target="_blank" className="min-w-0 flex-1"><span className="block truncate font-medium text-brand">{p.number} · {p.supplier}</span><span className="block truncate text-xs text-steel">{formatDate(p.date)} · {catLabel(p.category)}</span></a>
                ) : (
                  <Link href={`/buchhaltung/ausgaben/${p.id}`} className="min-w-0 flex-1"><span className="block truncate font-medium">{p.number} · {p.supplier}</span><span className="block truncate text-xs text-warn">Beleg fehlt</span></Link>
                )}
                <span className="text-right tabular-nums">{fmtEuroCents(p.grossCents)}<span className={clsx("block text-xs", p.status === "BEZAHLT" ? "text-ok" : "text-warn")}>{p.status === "BEZAHLT" ? "bezahlt" : "offen"}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3 className="flex items-center gap-2 border-b border-line p-4 font-semibold"><Landmark className="size-4 text-brand" /> Kontoauszüge <span className="ml-auto text-sm font-normal text-steel">{statements.length}</span></h3>
          {statements.length === 0 && <p className="p-4 text-sm text-steel">Noch kein Auszug für diesen Monat. <Link href="/buchhaltung/bank#auszuege" className="text-brand">Jetzt hinterlegen →</Link></p>}
          <ul className="divide-y divide-line text-sm">
            {statements.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-steel" />
                <a href={fileUrl(s.id)} target="_blank" className="min-w-0 flex-1"><span className="block truncate font-medium text-brand">{s.name}</span><span className="block truncate text-xs text-steel">{formatDate(new Date(`${s.from}T12:00:00`))} – {formatDate(new Date(`${s.to}T12:00:00`))} · {s.source === "pdf" ? "PDF der Bank" : `${s.count} Umsätze eingelesen`}</span></a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
