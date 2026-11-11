import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Plus, Trash2, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinDateTime, berlinParts, todayYmd } from "@/lib/berlin";
import { formatHours } from "@/lib/hours";
import { monthLabel, monthRange, runningEntry, thisMonth, TIME_KIND_LABEL, weekStart, type TimeKind } from "@/lib/zeiten";
import { deleteWorkTime } from "@/app/actions/zeiten";
import { ActionButton } from "@/components/confirm-button";
import { Clock } from "./clock";
import { AddTime } from "./add";

export const metadata = { title: "Stunden" };
export const dynamic = "force-dynamic";

const hm = (d: Date | null) => (d ? `${String(berlinParts(d).h).padStart(2, "0")}:${String(berlinParts(d).min).padStart(2, "0")}` : "");
const dayName = (ymd: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

export default async function StundenPage({ searchParams }: { searchParams: Promise<{ woche?: string; ansicht?: string; monat?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const admin = me.role === "ADMIN";
  const today = todayYmd();
  const projects = await db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  if (admin && sp.ansicht === "team") return <TeamView month={/^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : thisMonth()} />;

  const week = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(sp.woche ?? "") ? sp.woche! : today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(week, i));
  const [run, entries, users, monthSum] = await Promise.all([
    runningEntry(me.id),
    db.timeEntry.findMany({ where: { userId: me.id, day: { gte: berlinDateTime(week), lt: berlinDateTime(addDaysYmd(week, 7)) } }, orderBy: [{ day: "asc" }, { startAt: "asc" }], include: { project: { select: { id: true, name: true } } } }),
    admin ? db.user.findMany({ where: { id: { not: me.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve(null),
    db.timeEntry.aggregate({ _sum: { minutes: true }, where: { userId: me.id, kind: { in: ["ARBEIT", "FAHRT"] }, day: { gte: monthRange(thisMonth()).from, lt: monthRange(thisMonth()).to } } }),
  ]);
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = berlinParts(e.day).ymd;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const weekSum = entries.reduce((s, e) => s + e.minutes, 0);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Arbeitszeit</h1>
          <p className="mt-1 text-sm text-steel">Kommen/Gehen stempeln oder nachtragen. Diesen Monat: <b className="text-ink">{formatHours(monthSum._sum.minutes ?? 0)}</b></p>
        </div>
        {admin && <Link href="/stunden?ansicht=team" className="btn-secondary"><Users className="size-4" /> Team & Monat</Link>}
      </div>

      <section className="card p-5">
        <Clock running={run?.startAt ? { since: run.startAt.toISOString(), sinceLabel: `${hm(run.startAt)} Uhr`, project: run.project?.name ?? null } : null} projects={projects} />
      </section>

      <details className="card p-4">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Zeit nachtragen</summary>
        <div className="mt-3"><AddTime today={today} projects={projects} users={users} /></div>
      </details>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/stunden?woche=${addDaysYmd(week, -7)}`} className="btn-secondary px-2" aria-label="Woche zurück"><ChevronLeft className="size-4" /></Link>
          <h2 className="text-center font-semibold">Woche {dayName(week)} – {dayName(addDaysYmd(week, 6))} · {formatHours(weekSum)}</h2>
          <Link href={`/stunden?woche=${addDaysYmd(week, 7)}`} className={clsx("btn-secondary px-2", addDaysYmd(week, 7) > today && "pointer-events-none opacity-40")} aria-label="Woche vor"><ChevronRight className="size-4" /></Link>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const sum = list.reduce((s, e) => s + e.minutes, 0);
            return (
              <li key={d} className={clsx("py-2", d === today && "rounded-lg bg-brand-soft/50 px-2")}>
                <div className="flex items-center justify-between text-sm">
                  <span className={clsx("font-medium", d > today && "text-steel")}>{dayName(d)}</span>
                  <span className={sum ? "font-semibold" : "text-steel"}>{sum ? formatHours(sum) : "–"}</span>
                </div>
                {list.map((e) => (
                  <div key={e.id} className="mt-1 flex items-center gap-2 text-xs text-steel">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {e.startAt ? `${hm(e.startAt)}–${e.endAt ? hm(e.endAt) : "läuft"}` : TIME_KIND_LABEL[e.kind as TimeKind] ?? e.kind}
                      {e.pauseMin ? ` · Pause ${e.pauseMin} min` : ""}
                      {e.startAt && e.kind !== "ARBEIT" ? ` · ${TIME_KIND_LABEL[e.kind as TimeKind]}` : ""}
                      {e.project ? ` · ${e.project.name}` : ""}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className="shrink-0">{e.endAt || !e.startAt ? formatHours(e.minutes) : ""}</span>
                    {(e.endAt || !e.startAt) && <ActionButton action={deleteWorkTime.bind(null, e.id)} confirm="Eintrag löschen?" className="shrink-0 text-steel hover:text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

async function TeamView({ month }: { month: string }) {
  const r = monthRange(month);
  const [users, times, running, expenses] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.timeEntry.findMany({ where: { day: { gte: r.from, lt: r.to } }, select: { userId: true, minutes: true, kind: true, day: true } }),
    db.timeEntry.findMany({ where: { startAt: { not: null }, endAt: null }, include: { user: { select: { name: true } }, project: { select: { name: true } } } }),
    db.expense.groupBy({ by: ["userId"], _sum: { amountCents: true }, where: { day: { gte: r.from, lt: r.to }, status: { in: ["EINGEREICHT", "GENEHMIGT", "AUSGEZAHLT"] } } }),
  ]);
  const spesen = new Map(expenses.map((e) => [e.userId, e._sum.amountCents ?? 0]));
  const rows = users.map((u) => {
    const mine = times.filter((t) => t.userId === u.id);
    const sum = (k: string) => mine.filter((t) => t.kind === k).reduce((s, t) => s + t.minutes, 0);
    const daysOf = (k: string) => new Set(mine.filter((t) => t.kind === k).map((t) => t.day.toISOString())).size;
    return { ...u, arbeit: sum("ARBEIT"), fahrt: sum("FAHRT"), urlaub: daysOf("URLAUB"), krank: daysOf("KRANK"), tage: new Set(mine.filter((t) => t.kind === "ARBEIT").map((t) => t.day.toISOString())).size, spesen: spesen.get(u.id) ?? 0 };
  });
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/stunden" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ChevronLeft className="size-4" /> Meine Zeit</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Team · {monthLabel(month)}</h1>
        <div className="flex gap-2">
          <Link href={`/stunden?ansicht=team&monat=${r.prev}`} className="btn-secondary px-2" aria-label="Monat zurück"><ChevronLeft className="size-4" /></Link>
          <Link href={`/stunden?ansicht=team&monat=${r.next}`} className="btn-secondary px-2" aria-label="Monat vor"><ChevronRight className="size-4" /></Link>
          <a href={`/api/stunden/csv?monat=${month}`} className="btn-primary"><Download className="size-4" /> CSV für Lohn</a>
        </div>
      </div>

      {running.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="font-semibold">Gerade eingestempelt</h2>
          <ul className="mt-1 space-y-0.5 text-steel">{running.map((e) => <li key={e.id}><b className="text-ink">{e.user.name}</b> seit {hm(e.startAt)} Uhr{e.project ? ` · ${e.project.name}` : ""}</li>)}</ul>
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-mist text-left text-xs text-steel">
            <tr><th className="p-3">Mitarbeiter</th><th className="p-3 text-right">Arbeit</th><th className="p-3 text-right">Tage</th><th className="p-3 text-right">Fahrtzeit</th><th className="p-3 text-right">Urlaub</th><th className="p-3 text-right">Krank</th><th className="p-3 text-right">Spesen</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="p-3 font-medium">{u.name}</td>
                <td className="p-3 text-right font-semibold">{formatHours(u.arbeit)}</td>
                <td className="p-3 text-right">{u.tage}</td>
                <td className="p-3 text-right">{u.fahrt ? formatHours(u.fahrt) : "–"}</td>
                <td className="p-3 text-right">{u.urlaub ? `${u.urlaub} T.` : "–"}</td>
                <td className="p-3 text-right">{u.krank ? `${u.krank} T.` : "–"}</td>
                <td className="p-3 text-right"><Link href={`/spesen/zettel?monat=${month}&user=${u.id}`} className="text-brand hover:underline">{(u.spesen / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-steel">Arbeit = Netto-Stunden ohne Pausen. Fahrtzeit getrennt, weil sie je nach Vertrag anders vergütet wird. Die CSV öffnet sich in Excel (Semikolon, Umlaute korrekt).</p>
    </main>
  );
}
