import Link from "next/link";
import { AlertTriangle, BarChart3, Factory, CalendarClock, FileText, ClipboardList, Flag, HardHat, PackageX, ShoppingCart, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { lowStock, fmtQty } from "@/lib/stock";
import { currentPhase, progressOf } from "@/lib/phases";
import { PHASES } from "@/lib/phases-shared";
import { ProgressBar } from "@/components/progress-bar";
import { dueFollowUps } from "@/lib/crm";
import { revenue } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { todayYmd } from "@/lib/berlin";

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
  const prodCounts = await db.productionJob.groupBy({ by: ["status"], where: { status: { notIn: ["FERTIG", "MONTAGEBEREIT"] } }, _count: true });
  const inProd = prodCounts.reduce((a, x) => a + x._count, 0);
  const materialMissing = prodCounts.find((x) => x.status === "MATERIAL_FEHLT")?._count ?? 0;
  const followUps = await dueFollowUps(in14, 10);

  const withPhase = projects.map((p) => ({ ...p, pct: p.phases.length ? progressOf(p.phases) : null, cur: p.phases.length ? currentPhase(p.phases) : null }));
  const perPhase = PHASES.map((ph) => ({ ...ph, n: withPhase.filter((p) => p.cur?.key === ph.key).length }));
  const maxN = Math.max(1, ...perPhase.map((x) => x.n));
  const ordered = requests.filter((r) => r.status === "BESTELLT").length;
  const waiting = requests.length - ordered;
  const deadlines = [
    ...milestones.map((m) => ({ id: m.id, date: m.dueDate!, title: m.title, sub: m.project.name, href: `/projekte/${m.project.id}`, kind: "Meilenstein" })),
    ...phaseEnds.map((ph) => ({ id: ph.id, date: ph.endDate!, title: PHASES.find((x) => x.key === ph.key)?.title ?? ph.key, sub: ph.project.name, href: `/projekte/${ph.project.id}`, kind: "Phase endet" })),
    ...followUps.map((n) => ({ id: n.id, date: n.followUpAt!, title: n.text.length > 60 ? `${n.text.slice(0, 60)}…` : n.text, sub: `${n.customer.name}${n.assignee ? ` · ${n.assignee.name}` : ""}`, href: `/buchhaltung/kunden/${n.customer.id}`, kind: "Wiedervorlage" })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 10);

  const tiles = [
    { label: "Laufende Projekte", value: String(projects.length), hint: `${withPhase.filter((p) => p.cur?.key === "ANFRAGE").length} in Kundenanfrage`, icon: HardHat, href: "/projekte", tone: "text-brand" },
    { label: "Fertigungsaufträge", value: String(inProd), hint: materialMissing ? `${materialMissing} warten auf Material` : `${prodCounts.find((x) => x.status === "IN_FERTIGUNG")?._count ?? 0} in Fertigung`, icon: Factory, href: "/fertigung", tone: materialMissing ? "text-warn" : "text-brand" },
    { label: "Überfällige Aufgaben", value: String(overdueTasks.length), hint: overdueTasks.length ? "Termin überschritten" : "alles im Plan", icon: AlertTriangle, href: "/aufgaben", tone: overdueTasks.length ? "text-bad" : "text-ok" },
    { label: "Offene Bestellungen", value: String(ordered), hint: `${waiting} Anfragen warten auf Antwort/Entscheidung`, icon: ShoppingCart, href: "/lieferanten", tone: "text-ink" },
    { label: "Unter Mindestbestand", value: String(low.length), hint: low.length ? "nachbestellen" : "Lager ausreichend", icon: PackageX, href: "/lager", tone: low.length ? "text-warn" : "text-ok" },
  ];

  return (
    <section className="space-y-4" aria-labelledby="betrieb">
      <h2 id="betrieb" className="text-lg font-bold">Betrieb</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card p-4 transition first:col-span-2 hover:border-brand md:first:col-span-1">
            <div className="flex items-center gap-2 text-xs font-medium text-steel md:text-sm"><t.icon className="size-4 shrink-0" /> {t.label}</div>
            <p className={clsx("mt-1 text-3xl font-extrabold tracking-tight", t.tone)}>{t.value}</p>
            <p className="mt-0.5 text-xs text-steel">{t.hint}</p>
          </Link>
        ))}
      </div>

      <SalesRow />

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
            <h3 className="font-bold">Fristen & Wiedervorlagen</h3>
          </div>
          {deadlines.length === 0 ? (
            <p className="text-sm text-steel">Keine Fristen in den nächsten zwei Wochen.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {deadlines.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-2">
                  <span className={clsx("w-16 shrink-0 text-xs font-semibold", d.date < now ? "text-bad" : "text-brand")}>{formatDate(d.date).slice(0, 6)}</span>
                  <Link href={d.href} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.kind === "Meilenstein" && <Flag className="mr-1 inline size-3.5 text-steel" />}{d.title}</span>
                    <span className="block truncate text-xs text-steel">{d.kind} · {d.sub}</span>
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

/** Vertrieb: Umsatz der letzten 6 Monate (netto) und Angebots-Pipeline aus der eigenen Buchhaltung */
async function SalesRow() {
  const today = todayYmd();
  const [y, m] = today.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, k) => {
    const d = new Date(Date.UTC(y, m - 1 - (5 - k), 1));
    const ym = d.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { ym, from: `${ym}-01`, to: last < today ? last : today, label: d.toLocaleDateString("de-DE", { month: "short", timeZone: "UTC" }) };
  });
  const [rev, quotes] = await Promise.all([
    Promise.all(months.map((x) => revenue(x.from, x.to))),
    db.salesDoc.groupBy({ by: ["status"], where: { kind: "ANGEBOT", status: { in: ["OFFEN", "ANGENOMMEN", "ABGELEHNT"] } }, _sum: { netCents: true }, _count: true }),
  ]);
  const max = Math.max(1, ...rev.map((r) => r.netCents));
  const q = (s: string) => quotes.find((x) => x.status === s);
  const won = q("ANGENOMMEN")?._count ?? 0;
  const lost = q("ABGELEHNT")?._count ?? 0;
  const rate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <section className="card min-w-0 p-5">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="size-5 text-brand" />
          <h3 className="font-bold">Umsatz netto, letzte 6 Monate</h3>
          <Link href="/buchhaltung" className="ml-auto text-sm font-medium text-brand">Buchhaltung</Link>
        </div>
        {/* Eine Reihe → eine Farbe; Wert steht über jedem Balken, Tooltip per title */}
        <div className="grid h-44 grid-cols-6 items-end gap-3" role="img" aria-label={`Umsatz netto: ${months.map((x, i) => `${x.label} ${fmtEuroCents(rev[i].netCents)}`).join(", ")}`}>
          {months.map((x, i) => (
            <div key={x.ym} className="flex h-full flex-col items-center justify-end gap-1" title={`${x.label}: ${fmtEuroCents(rev[i].netCents)} (${rev[i].count} Rechnungen)`}>
              <span className="text-[11px] font-semibold text-ink">{rev[i].netCents ? `${Math.round(rev[i].netCents / 100000).toLocaleString("de-DE")} T€` : ""}</span>
              <span className={clsx("w-full max-w-12 rounded-t", i === 5 ? "bg-brand" : "bg-brand/60")} style={{ height: `${Math.max(rev[i].netCents ? 2 : 0, (rev[i].netCents / max) * 100)}%` }} />
              <span className="text-xs text-steel">{x.label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card min-w-0 p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-5 text-brand" />
          <h3 className="font-bold">Angebote</h3>
          <Link href="/buchhaltung/belege?art=angebote" className="ml-auto text-sm font-medium text-brand">Alle</Link>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-steel">Offen</dt><dd className="text-xl font-extrabold">{fmtEuroCents(q("OFFEN")?._sum.netCents ?? 0)}</dd><dd className="text-xs text-steel">{q("OFFEN")?._count ?? 0} {(q("OFFEN")?._count ?? 0) === 1 ? "Angebot" : "Angebote"}</dd></div>
          <div><dt className="text-xs text-steel">Angenommen (Auftragsvolumen)</dt><dd className="text-xl font-extrabold text-brand">{fmtEuroCents(q("ANGENOMMEN")?._sum.netCents ?? 0)}</dd><dd className="text-xs text-steel">{won} {won === 1 ? "Angebot" : "Angebote"}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-steel">Annahmequote</dt><dd className="font-semibold">{rate === null ? "noch keine Entscheidungen" : `${rate} % (${won} angenommen, ${lost} abgelehnt)`}</dd></div>
        </dl>
      </section>
    </div>
  );
}
