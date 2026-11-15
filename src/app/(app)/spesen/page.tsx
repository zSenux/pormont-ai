import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, Download, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, todayYmd } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { KIND_LABEL, MEAL_LABEL, MEAL_RATES, NIGHT_FLAT, KM_RATE, STATUS_LABEL, STATUS_TONE, TAX_LABEL, euro, flatTaxOf, sumSplit, taxSplit, type ExpenseKind, type MealDay } from "@/lib/spesen";
import { spesenRates } from "@/lib/spesen-config";
import { monthLabel, monthRange, thisMonth } from "@/lib/zeiten";
import { approveMonth, deleteExpense, markPaid } from "@/app/actions/spesen";
import { ActionButton } from "@/components/confirm-button";
import { ExpenseForm } from "./form";
import { ReviewButtons } from "./review";
import { RatesForm } from "./rates";

export const metadata = { title: "Spesen" };
export const dynamic = "force-dynamic";

type Row = { id: string; day: Date; kind: string; description: string; km: number | null; amountCents: number; status: keyof typeof STATUS_LABEL; fileId: string | null; reviewNote: string | null; project: { name: string } | null; mealDay: string | null; breakfast: boolean; lunch: boolean; dinner: boolean };

/** „steuerfrei 14 € · pauschal 25 % 6 €“ – nur wenn nicht alles steuerfrei ist */
function SplitNote({ e }: { e: Row }) {
  const t = taxSplit(e);
  if (!t.flat25 && !t.taxable) return null;
  return <p className="text-[11px] text-steel">{euro(t.free)} steuerfrei{t.flat25 ? ` · ${euro(t.flat25)} pauschal 25 %` : ""}{t.taxable ? ` · ${euro(t.taxable)} lohnsteuerpflichtig` : ""}</p>;
}

/** Monatssumme nach Steuer aufgeteilt */
function SplitSummary({ rows, className = "" }: { rows: Row[]; className?: string }) {
  const t = sumSplit(rows.filter((e) => e.status !== "ABGELEHNT"));
  const f = flatTaxOf(t.flat25);
  return (
    <dl className={`grid grid-cols-3 gap-2 text-center text-xs ${className}`}>
      <div className="rounded-xl bg-emerald-50 p-2"><dt className="text-emerald-800">{TAX_LABEL.free}</dt><dd className="text-sm font-semibold text-ink">{euro(t.free)}</dd></div>
      <div className="rounded-xl bg-amber-50 p-2"><dt className="text-amber-800">pauschal 25 %</dt><dd className="text-sm font-semibold text-ink">{euro(t.flat25)}</dd>{t.flat25 > 0 && <dd className="text-[10px] text-steel">LSt. {euro(f.lst)} + Soli {euro(f.soli)}</dd>}</div>
      <div className="rounded-xl bg-red-50 p-2"><dt className="text-red-800">{TAX_LABEL.taxable}</dt><dd className="text-sm font-semibold text-ink">{euro(t.taxable)}</dd></div>
    </dl>
  );
}

function Line({ e, who, children }: { e: Row; who?: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        {who && <p className="text-xs font-semibold text-brand">{who}</p>}
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{e.description}</p>
        <p className="text-xs text-steel">
          {formatDate(e.day)} · {KIND_LABEL[e.kind as ExpenseKind] ?? e.kind}{e.km ? ` · ${e.km} km` : ""}{e.project ? ` · ${e.project.name}` : ""}
          {e.fileId && <> · <a href={fileUrl(e.fileId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand"><Paperclip className="size-3" /> Beleg</a></>}
        </p>
        <SplitNote e={e} />
        {e.reviewNote && <p className="mt-0.5 text-xs text-bad">„{e.reviewNote}“</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-semibold tabular-nums">{euro(e.amountCents)}</span>
        <span className={clsx("chip px-2 py-0.5 text-[11px]", STATUS_TONE[e.status])}>{STATUS_LABEL[e.status]}</span>
      </div>
      {children}
    </li>
  );
}

export default async function SpesenPage({ searchParams }: { searchParams: Promise<{ monat?: string; ansicht?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const admin = me.role === "ADMIN";
  const month = /^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : thisMonth();
  const r = monthRange(month);
  const include = { project: { select: { name: true } } };

  if (admin && sp.ansicht === "pruefen") {
    const open = await db.expense.findMany({ where: { status: "EINGEREICHT" }, orderBy: [{ day: "asc" }], include: { ...include, user: { select: { id: true, name: true } } } });
    const monthRows = await db.expense.groupBy({ by: ["userId", "status"], _sum: { amountCents: true }, where: { day: { gte: r.from, lt: r.to } } });
    const users = await db.user.findMany({ where: { id: { in: [...new Set(monthRows.map((x) => x.userId))] } }, select: { id: true, name: true } });
    const [all, rates] = await Promise.all([db.expense.findMany({ where: { day: { gte: r.from, lt: r.to } }, include }), spesenRates()]);
    return (
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
        <Link href="/spesen" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ChevronLeft className="size-4" /> Meine Spesen</Link>
        <h1 className="page-title">Spesen prüfen</h1>
        <section className="card p-4">
          <h2 className="font-semibold">Offen ({open.length})</h2>
          {open.length === 0 ? <p className="mt-2 text-sm text-steel">Nichts zu prüfen.</p> : (
            <ul className="divide-y divide-line">
              {open.map((e) => (
                <Line key={e.id} e={e} who={e.user.name}><ReviewButtons id={e.id} /></Line>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/spesen?ansicht=pruefen&monat=${r.prev}`} className="btn-secondary px-2" aria-label="Monat zurück"><ChevronLeft className="size-4" /></Link>
            <h2 className="font-semibold">{monthLabel(month)}</h2>
            <Link href={`/spesen?ansicht=pruefen&monat=${r.next}`} className="btn-secondary px-2" aria-label="Monat vor"><ChevronRight className="size-4" /></Link>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {users.length === 0 && <li className="py-2 text-sm text-steel">Keine Spesen in diesem Monat.</li>}
            {users.map((u) => {
              const sum = (s: string) => monthRows.filter((x) => x.userId === u.id && x.status === s).reduce((a, x) => a + (x._sum.amountCents ?? 0), 0);
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                  <span className="min-w-0 flex-1"><b>{u.name}</b><span className="block text-xs text-steel">offen {euro(sum("EINGEREICHT"))} · genehmigt {euro(sum("GENEHMIGT"))} · ausgezahlt {euro(sum("AUSGEZAHLT"))}</span>{(() => { const t = sumSplit(all.filter((e) => e.userId === u.id && e.status !== "ABGELEHNT")); return t.flat25 || t.taxable ? <span className="block text-xs text-steel">für den Lohn: {euro(t.free)} steuerfrei · {euro(t.flat25)} pauschal 25 % · {euro(t.taxable)} lohnsteuerpflichtig</span> : null; })()}</span>
                  {sum("EINGEREICHT") > 0 && <ActionButton action={approveMonth.bind(null, u.id, month)} confirm={`Alle offenen Spesen von ${u.name} genehmigen?`}>Alle genehmigen</ActionButton>}
                  {sum("GENEHMIGT") > 0 && <ActionButton action={markPaid.bind(null, u.id, month)} confirm={`${euro(sum("GENEHMIGT"))} an ${u.name} als ausgezahlt markieren?`}>Ausgezahlt</ActionButton>}
                  <Link href={`/spesen/zettel?monat=${month}&user=${u.id}`} className="btn-secondary"><FileText className="size-4" /> Zettel</Link>
                </li>
              );
            })}
          </ul>
          {all.length > 0 && <SplitSummary rows={all} className="mt-3" />}
          <a href={`/api/spesen/csv?monat=${month}`} className="btn-secondary mt-3 w-fit"><Download className="size-4" /> CSV für Lohn/Buchhaltung</a>
        </section>
        <section id="saetze" className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Spesensätze der Firma</h2>
            <p className="mt-1 text-xs text-steel">Was ProMont zahlt. Bis zur gesetzlichen Pauschale steuerfrei; bei Verpflegung kann der Betrag darüber bis zur Höhe der Pauschale mit 25 % pauschal versteuert werden (§ 40 Abs. 2 Nr. 4 EStG, trägt die Firma). Alles darüber und mehr als {euro(KM_RATE)}/km ist normaler Arbeitslohn.</p>
          </div>
          <RatesForm rates={rates} legal={{ meal: MEAL_RATES, km: KM_RATE, night: NIGHT_FLAT }} labels={MEAL_LABEL as Record<MealDay, string>} />
        </section>
      </main>
    );
  }

  const [projects, mine, openCount, rates] = await Promise.all([
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.expense.findMany({ where: { userId: me.id, day: { gte: r.from, lt: r.to } }, orderBy: [{ day: "desc" }, { createdAt: "desc" }], include }),
    admin ? db.expense.count({ where: { status: "EINGEREICHT" } }) : Promise.resolve(0),
    spesenRates(),
  ]);
  const total = mine.filter((e) => e.status !== "ABGELEHNT").reduce((s, e) => s + e.amountCents, 0);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Spesen</h1>
          <p className="mt-1 text-sm text-steel">Verpflegung, Kilometer und Auslagen einreichen – ein Administrator gibt frei.</p>
        </div>
        {admin && <Link href="/spesen?ansicht=pruefen" className="btn-secondary"><ClipboardCheck className="size-4" /> Prüfen{openCount ? ` (${openCount})` : ""}</Link>}
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Neu einreichen</h2>
        <ExpenseForm today={todayYmd()} projects={projects} rates={rates} />
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/spesen?monat=${r.prev}`} className="btn-secondary px-2" aria-label="Monat zurück"><ChevronLeft className="size-4" /></Link>
          <h2 className="text-center font-semibold">{monthLabel(month)} · {euro(total)}</h2>
          <Link href={`/spesen?monat=${r.next}`} className={clsx("btn-secondary px-2", r.next > thisMonth() && "pointer-events-none opacity-40")} aria-label="Monat vor"><ChevronRight className="size-4" /></Link>
        </div>
        <ul className="mt-2 divide-y divide-line">
          {mine.length === 0 && <li className="py-3 text-sm text-steel">Keine Spesen in diesem Monat.</li>}
          {mine.map((e) => (
            <Line key={e.id} e={e}>
              {e.status === "EINGEREICHT" && <ActionButton action={deleteExpense.bind(null, e.id)} confirm="Zurückziehen und löschen?" className="mt-1 shrink-0 text-steel hover:text-bad" title="Löschen"><Trash2 className="size-4" /></ActionButton>}
            </Line>
          ))}
        </ul>
        {mine.some((e) => { const t = taxSplit(e); return t.flat25 || t.taxable; }) && <SplitSummary rows={mine} className="mt-3" />}
        {mine.length > 0 && <Link href={`/spesen/zettel?monat=${month}`} className="btn-secondary mt-3 w-fit"><FileText className="size-4" /> Spesenzettel {monthLabel(month)}</Link>}
      </section>
      <p className="px-1 text-xs text-steel">Steuerfrei: Verpflegung 14 € (über 8 Std. bzw. An-/Abreisetag), 28 € (24 Std.), Kürzung bei gestellten Mahlzeiten; 0,30 € je km; Übernachtung ohne Beleg 20 €. Zahlt die Firma mehr, wird der Rest bei Verpflegung pauschal mit 25 % versteuert. Richtwerte nach EStG – keine Steuerberatung.</p>
    </main>
  );
}
