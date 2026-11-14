import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardList, Flag, HardHat, PackageX, ShoppingCart, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { lowStock, fmtQty } from "@/lib/stock";
import { currentPhase, progressOf } from "@/lib/phases";
import { PHASES } from "@/lib/phases-shared";
import { ProgressBar } from "@/components/progress-bar";

// Betriebs-Übersicht (EPS-Dashboard): laufende Projekte mit Fortschritt, Projekte je Phase, Fristen,
// überfällige Aufgaben, Lager unter Mindestbestand, offene Bestellungen/Anfragen, wer heute eingestempelt ist.

const DAY = 86400_000;

export async function BetriebOverview() {
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * DAY);
  const [projects, overdueTasks, low, requests, milestones, phaseEnds, clockedIn, users] = await Promise.all([
    db.project.findMany({
      where: { status: { not: "FERTIG" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, customer: true, status: true, endDate: true, leader: { select: { name: true } }, phases: { select: { key: true, status: true, sort: true } } },
    }),
    db.task.findMany({ where: { doneAt: null, dueAt: { lt: now } }, orderBy: { dueAt: "asc" }, take: 8, include: { assignee: { select: { name: true } }, project: { select: { id: true, name: true } } } }),
    lowStock(8),
    db.supplierRequest.findMany({ where: { status: { in: ["GESENDET", "ANGEBOT", "BESTELLT"] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, status: true, subject: true, dueAt: true, supplier: { select: { name: true } } } }),
    db.projectMilestone.findMany({ where: { doneAt: null, dueDate: { lte: in14 } }, orderBy: { dueDate: "asc" }, take: 10, include: { project: { select: { id: true, name: true } } } }),
    db.projectPhase.findMany({ where: { status: { in: ["OFFEN", "LAEUFT"] }, endDate: { lte: in14 }, project: { status: { not: "FERTIG" } } }, orderBy: { endDate: "asc" }, take: 10, include: { project: { select: { id: true, name: true } } } }),
    db.timeEntry.findMany({ where: { startAt: { not: null }, endAt: null }, select: { userId: true, project: { select: { name: true } } } }),
    db.user.count(),
  ]);

  const withPhase = projects.map((p) => ({ ...p, pct: p.phases.length ? progressOf(p.phases) : null, cur: p.phases.length ? currentPhase(p.phases) : null }));
  const perPhase = PHASES.map((ph) => ({ ...ph, n: withPhase.filter((p) => p.cur?.key === ph.key).length }));
  const maxN = Math.max(1, ...perPhase.map((x) => x.n));
  const ordered = requests.filter((r) => r.status === "BESTELLT").length;
  const waiting = requests.length - ordered;
  const deadlines = [
    ...milestones.map((m) => ({ id: m.id, date: m.dueDate!, title: m.title, project: m.project, kind: "Meilenstein" })),
    ...phaseEnds.map((ph) => ({ id: ph.id, date: ph.endDate!, title: PHASES.find((x) => x.key === ph.key)?.title ?? ph.key, project: ph.project, kind: "Phase endet" })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 8);

  const tiles = [
    { label: "Laufende Projekte", value: String(projects.length), hint: `${withPhase.filter((p) => p.cur?.key === "ANFRAGE").length} in Kundenanfrage`, icon: HardHat, href: "/projekte", tone: "text-brand" },
    { label: "Überfällige Aufgaben", value: String(overdueTasks.length), hint: overdueTasks.length ? "Termin überschritten" : "alles im Plan", icon: AlertTriangle, href: "/aufgaben", tone: overdueTasks.length ? "text-bad" : "text-ok" },
    { label: "Offene Bestellungen", value: String(ordered), hint: `${waiting} Anfragen warten auf Antwort/Entscheidung`, icon: ShoppingCart, href: "/lieferanten", tone: "text-ink" },
    { label: "Unter Mindestbestand", value: String(low.length), hint: low.length ? "nachbestellen" : "Lager ausreichend", icon: PackageX, href: "/lager", tone: low.length ? "text-warn" : "text-ok" },
  ];

  return (
    <section className="space-y-4" aria-labelledby="betrieb">
      <h2 id="betrieb" className="text-lg font-bold">Betrieb</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card p-4 transition hover:border-brand">
            <div className="flex items-center gap-2 text-xs font-medium text-steel md:text-sm"><t.icon className="size-4 shrink-0" /> {t.label}</div>
            <p className={clsx("mt-1 text-3xl font-extrabold tracking-tight", t.tone)}>{t.value}</p>
            <p className="mt-0.5 text-xs text-steel">{t.hint}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <HardHat className="size-5 text-brand" />
            <h3 className="font-bold">Projektfortschritt</h3>
            <Link href="/projekte" className="ml-auto text-sm font-medium text-brand">Alle</Link>
          </div>
          {withPhase.length === 0 ? (
            <p className="text-sm text-steel">Keine laufenden Projekte.</p>
          ) : (
            <ul className="space-y-3">
              {withPhase.slice(0, 8).map((p) => {
                const late = p.endDate && p.endDate < now;
                return (
                  <li key={p.id}>
                    <Link href={`/projekte/${p.id}`} className="block space-y-1 rounded-xl p-1 hover:bg-mist">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{p.name}</span>
                        <span className="shrink-0 text-xs text-steel">{p.pct !== null ? `${p.pct} %` : "–"}</span>
                      </div>
                      {p.pct !== null && <ProgressBar pct={p.pct} />}
                      <p className={clsx("truncate text-xs", late ? "text-bad" : "text-steel")}>
                        {[p.cur ? PHASES.find((x) => x.key === p.cur!.key)?.title : "alle Phasen erledigt", p.leader?.name && `PL ${p.leader.name}`, p.customer, p.endDate && `${late ? "Ende überschritten: " : "bis "}${formatDate(p.endDate)}`].filter(Boolean).join(" · ")}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="size-5 text-brand" />
            <h3 className="font-bold">Projekte je Phase</h3>
          </div>
          {/* Ein Wert je Phase → eine Farbe (Markenblau), Zahl steht als Text daneben */}
          <ul className="space-y-1.5" aria-label="Anzahl laufender Projekte je aktueller Phase">
            {perPhase.map((ph) => (
              <li key={ph.key} className="grid grid-cols-[9.5rem_1fr_1.5rem] items-center gap-2 text-xs" title={`${ph.title}: ${ph.n} ${ph.n === 1 ? "Projekt" : "Projekte"}`}>
                <span className="truncate text-steel">{ph.title}</span>
                <span className="h-3 rounded-r bg-mist">
                  {ph.n > 0 && <span className="block h-full rounded-r bg-brand" style={{ width: `${(ph.n / maxN) * 100}%` }} />}
                </span>
                <span className="text-right font-semibold text-ink">{ph.n || ""}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="size-5 text-brand" />
            <h3 className="font-bold">Fristen (14 Tage)</h3>
          </div>
          {deadlines.length === 0 ? (
            <p className="text-sm text-steel">Keine Fristen in den nächsten zwei Wochen.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {deadlines.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-2">
                  <span className={clsx("w-16 shrink-0 text-xs font-semibold", d.date < now ? "text-bad" : "text-brand")}>{formatDate(d.date).slice(0, 6)}</span>
                  <Link href={`/projekte/${d.project.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.kind === "Meilenstein" && <Flag className="mr-1 inline size-3.5 text-steel" />}{d.title}</span>
                    <span className="block truncate text-xs text-steel">{d.kind} · {d.project.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="size-5 text-bad" />
            <h3 className="font-bold">Überfällige Aufgaben</h3>
            <Link href="/aufgaben" className="ml-auto text-sm font-medium text-brand">Alle</Link>
          </div>
          {overdueTasks.length === 0 ? (
            <p className="text-sm text-steel">Nichts überfällig.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {overdueTasks.map((t) => (
                <li key={t.id} className="py-2">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-bad">
                    fällig {formatDate(t.dueAt)}{t.assignee && ` · ${t.assignee.name}`}{t.project && ` · ${t.project.name}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card min-w-0 p-5 md:col-span-2 lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <Users className="size-5 text-brand" />
            <h3 className="font-bold">Team heute</h3>
            <Link href="/stunden" className="ml-auto text-sm font-medium text-brand">Stunden</Link>
          </div>
          <p className="text-sm">
            <strong className="text-2xl font-extrabold text-brand">{new Set(clockedIn.map((c) => c.userId)).size}</strong>
            <span className="text-steel"> von {users} gerade eingestempelt</span>
          </p>
          {low.length > 0 && (
            <>
              <h4 className="mt-4 flex items-center gap-1.5 text-sm font-semibold"><PackageX className="size-4 text-warn" /> Nachbestellen</h4>
              <ul className="mt-1 space-y-1 text-xs">
                {low.slice(0, 5).map((x) => (
                  <li key={x.id}>
                    <Link href={`/lager/${x.id}`} className="flex justify-between gap-2 hover:text-brand">
                      <span className="truncate">{x.name}</span>
                      <span className="shrink-0 text-warn">{fmtQty(x.quantity, x.unit)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
