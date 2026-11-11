import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, Download, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, todayYmd } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, euro, type ExpenseKind } from "@/lib/spesen";
import { monthLabel, monthRange, thisMonth } from "@/lib/zeiten";
import { approveMonth, deleteExpense, markPaid } from "@/app/actions/spesen";
import { ActionButton } from "@/components/confirm-button";
import { ExpenseForm } from "./form";
import { ReviewButtons } from "./review";

export const metadata = { title: "Spesen" };
export const dynamic = "force-dynamic";

type Row = { id: string; day: Date; kind: string; description: string; km: number | null; amountCents: number; status: keyof typeof STATUS_LABEL; fileId: string | null; reviewNote: string | null; project: { name: string } | null };

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
                  <span className="min-w-0 flex-1"><b>{u.name}</b><span className="block text-xs text-steel">offen {euro(sum("EINGEREICHT"))} · genehmigt {euro(sum("GENEHMIGT"))} · ausgezahlt {euro(sum("AUSGEZAHLT"))}</span></span>
                  {sum("EINGEREICHT") > 0 && <ActionButton action={approveMonth.bind(null, u.id, month)} confirm={`Alle offenen Spesen von ${u.name} genehmigen?`}>Alle genehmigen</ActionButton>}
                  {sum("GENEHMIGT") > 0 && <ActionButton action={markPaid.bind(null, u.id, month)} confirm={`${euro(sum("GENEHMIGT"))} an ${u.name} als ausgezahlt markieren?`}>Ausgezahlt</ActionButton>}
                  <Link href={`/spesen/zettel?monat=${month}&user=${u.id}`} className="btn-secondary"><FileText className="size-4" /> Zettel</Link>
                </li>
              );
            })}
          </ul>
          <a href={`/api/spesen/csv?monat=${month}`} className="btn-secondary mt-3 w-fit"><Download className="size-4" /> CSV für Lohn/Buchhaltung</a>
        </section>
      </main>
    );
  }

  const [projects, mine, openCount] = await Promise.all([
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.expense.findMany({ where: { userId: me.id, day: { gte: r.from, lt: r.to } }, orderBy: [{ day: "desc" }, { createdAt: "desc" }], include }),
    admin ? db.expense.count({ where: { status: "EINGEREICHT" } }) : Promise.resolve(0),
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
        <ExpenseForm today={todayYmd()} projects={projects} />
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
        {mine.length > 0 && <Link href={`/spesen/zettel?monat=${month}`} className="btn-secondary mt-3 w-fit"><FileText className="size-4" /> Spesenzettel {monthLabel(month)}</Link>}
      </section>
      <p className="px-1 text-xs text-steel">Pauschalen: Verpflegung 14 € (über 8 Std. bzw. An-/Abreisetag), 28 € (24 Std.); Kürzung bei gestellten Mahlzeiten; 0,30 € je km. Richtwerte nach EStG – keine Steuerberatung.</p>
    </main>
  );
}
