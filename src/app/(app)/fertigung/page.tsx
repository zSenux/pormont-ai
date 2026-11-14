import Link from "next/link";
import { AlertTriangle, ArrowRight, Factory, Gauge, PackageX, Plus } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, formatDate, todayYmd, addDaysYmd, berlinParts } from "@/lib/berlin";
import { capacity } from "@/lib/production";
import { MACHINES, NEXT_STEP, PROD_LABEL, PROD_STATUS, PROD_TONE, type ProdStatus } from "@/lib/production-shared";
import { PRIORITY_LABEL, PRIORITY_TONE, type Priority } from "@/lib/phases-shared";
import { moveJob, newJob } from "@/app/actions/fertigung";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Fertigung" };
export const dynamic = "force-dynamic";

const WEEK_HOURS = 40;

export default async function FertigungPage({ searchParams }: { searchParams: Promise<{ projekt?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const since = new Date(Date.now() - 14 * 86400_000);
  // Montag dieser Woche (Berlin)
  const today = todayYmd();
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysYmd(today, -dow);
  const [jobs, projects, users, cap, capNext] = await Promise.all([
    db.productionJob.findMany({
      where: { OR: [{ status: { notIn: ["FERTIG", "MONTAGEBEREIT"] } }, { doneAt: { gte: since } }] },
      orderBy: [{ plannedEnd: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      include: { project: { select: { id: true, name: true } }, assignee: { select: { name: true } } },
    }),
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true, order: { select: { number: true } } } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    capacity(berlinDateTime(monday)),
    capacity(berlinDateTime(addDaysYmd(monday, 7))),
  ]);
  const now = new Date();
  const prioRank: Record<string, number> = { DRINGEND: 0, HOCH: 1, NORMAL: 2, NIEDRIG: 3 };

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Fertigung</h1>
          <p className="mt-1 text-sm text-steel">Fertigungskarten der Werkstatt – von der Arbeitsvorbereitung bis „zur Montage bereit“. Sind alle Karten eines Projekts fertig, wird die Montage freigegeben.</p>
        </div>
      </div>

      <details className="card p-4" open={Boolean(sp.projekt)}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Neuer Fertigungsauftrag</summary>
        <form action={newJob} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select name="projectId" required defaultValue={sp.projekt ?? ""} className="input sm:col-span-2" aria-label="Projekt">
            <option value="" disabled>Projekt / Auftrag</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.order ? `${p.order.number} · ` : ""}{p.name}</option>)}
          </select>
          <input name="title" required minLength={2} placeholder="z. B. Treppenwangen schweißen" className="input sm:col-span-2" aria-label="Bezeichnung" />
          <input name="quantity" placeholder="Menge, z. B. 2 Stk" className="input" aria-label="Menge" />
          <input name="machine" list="maschinen" placeholder="Maschine / Arbeitsplatz" className="input" aria-label="Maschine" />
          <datalist id="maschinen">{MACHINES.map((m) => <option key={m} value={m} />)}</datalist>
          <select name="assigneeId" className="input" aria-label="Mitarbeiter" defaultValue="">
            <option value="">Mitarbeiter</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input name="plannedHours" inputMode="decimal" placeholder="Plan-Stunden" className="input" aria-label="Plan-Stunden" />
          <label className="text-xs text-steel">Beginn<input name="start" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Fertig bis<input name="end" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Priorität
            <select name="priority" defaultValue="NORMAL" className="input mt-1 w-full">{(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          </label>
          <textarea name="instructions" rows={2} placeholder="Arbeitsanweisung: Schritte, Maße, Schweißnähte, Hinweise" className="input resize-y sm:col-span-2 lg:col-span-4" aria-label="Arbeitsanweisung" />
          <button className="btn-primary sm:col-span-2 sm:justify-self-end lg:col-span-4">Anlegen</button>
        </form>
      </details>

      {/* Kanban: eine Spalte je Status, auf dem Handy waagerecht wischen */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="grid min-w-max auto-cols-[17rem] grid-flow-col gap-3">
          {PROD_STATUS.map((col) => {
            const list = jobs.filter((j) => j.status === col.key).sort((a, b) => (prioRank[a.priority] ?? 2) - (prioRank[b.priority] ?? 2));
            return (
              <section key={col.key} className="rounded-2xl bg-mist/60 p-2" aria-label={col.label}>
                <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
                  <span className={clsx("chip px-2 py-0.5 text-xs", PROD_TONE[col.key])}>{col.label}</span>
                  <span className="text-xs text-steel">{list.length}</span>
                </h2>
                <ul className="space-y-2">
                  {list.map((j) => {
                    const late = j.plannedEnd && j.plannedEnd < now && !["FERTIG", "MONTAGEBEREIT"].includes(j.status);
                    const next = NEXT_STEP[j.status as ProdStatus];
                    const prio = j.priority as Priority;
                    return (
                      <li key={j.id} className="card space-y-1.5 p-3 text-sm">
                        <Link href={`/fertigung/${j.id}`} className="block space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-brand">{j.number}</span>
                            {prio !== "NORMAL" && <span className={clsx("chip px-1.5 py-0 text-[10px]", PRIORITY_TONE[prio])}>{PRIORITY_LABEL[prio]}</span>}
                          </div>
                          <p className="font-medium leading-snug">{j.title}{j.quantity && <span className="text-steel"> · {j.quantity}</span>}</p>
                          <p className="truncate text-xs text-steel">{j.project.name}</p>
                          <p className={clsx("text-xs", late ? "font-semibold text-bad" : "text-steel")}>
                            {[j.assignee?.name, j.machine, j.plannedHours ? `${j.plannedHours.toLocaleString("de-DE")} Std.` : null, j.plannedEnd && `bis ${formatDate(j.plannedEnd).slice(0, 6)}`].filter(Boolean).join(" · ") || "noch nicht eingeplant"}
                          </p>
                          {!j.materialOk && !["FERTIG", "MONTAGEBEREIT"].includes(j.status) && <p className="flex items-center gap-1 text-xs text-warn"><PackageX className="size-3.5" /> Material nicht bestätigt</p>}
                        </Link>
                        {next && (
                          <ActionButton action={moveJob.bind(null, j.id, next)} className="flex w-full items-center justify-center gap-1 rounded-xl border border-line py-1 text-xs font-medium text-brand hover:border-brand">
                            {PROD_LABEL[next]} <ArrowRight className="size-3.5" />
                          </ActionButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {[{ title: "Auslastung diese Woche", c: cap }, { title: "Auslastung nächste Woche", c: capNext }].map(({ title, c }) => (
          <section key={title} className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Gauge className="size-4 text-brand" /> {title}</h2>
            {c.jobs === 0 ? <p className="text-sm text-steel">Keine eingeplanten Karten.</p> : (
              <>
                <p className="text-xs text-steel">Plan-Stunden offener Karten je Mitarbeiter (Richtwert {WEEK_HOURS} Std./Woche)</p>
                <ul className="space-y-1.5">
                  {c.workers.map(([name, h]) => (
                    <li key={name} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-xs" title={`${name}: ${h.toLocaleString("de-DE")} Std.`}>
                      <span className="truncate text-steel">{name}</span>
                      <span className="h-3 rounded-r bg-mist"><span className={clsx("block h-full rounded-r", h > WEEK_HOURS ? "bg-bad" : "bg-brand")} style={{ width: `${Math.min(100, (h / WEEK_HOURS) * 100)}%` }} /></span>
                      <span className={clsx("text-right font-semibold", h > WEEK_HOURS ? "text-bad" : "text-ink")}>{h.toLocaleString("de-DE")} h</span>
                    </li>
                  ))}
                </ul>
                <p className="pt-1 text-xs text-steel">Maschinen: {c.machines.map(([m, h]) => `${m} ${h.toLocaleString("de-DE")} h`).join(" · ")}</p>
                {c.workers.some(([, h]) => h > WEEK_HOURS) && <p className="flex items-center gap-1 text-xs text-bad"><AlertTriangle className="size-3.5" /> Überplant – Karten verschieben oder umverteilen.</p>}
              </>
            )}
          </section>
        ))}
      </div>
      <p className="flex items-center gap-1 text-xs text-steel"><Factory className="size-3.5" /> Woche ab {formatDate(berlinDateTime(monday))} · KW {isoWeek(berlinParts().ymd)}</p>
    </main>
  );
}

function isoWeek(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - first.getTime()) / 86400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
