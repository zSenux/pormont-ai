import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Calendar, Camera, CheckSquare, Clock, FileText, FolderSearch, HardHat, Mic, Sparkles, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { firstName, requireUser } from "@/lib/auth/user";
import { berlinDateTime, berlinParts, formatDate, formatDateTime, formatEuro, todayYmd } from "@/lib/berlin";
import { customerName, isOverdue, openInvoices, revenue } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { COMPANY } from "@/lib/company";
import { timeHm, todayEvents } from "@/lib/calendar";
import { WindowsAppBanner } from "@/components/windows-app";
import { latestWindowsRelease } from "@/lib/windows-app";
import { BetriebOverview } from "@/components/betrieb";

export const dynamic = "force-dynamic";

function greeting() {
  const h = berlinParts().h;
  return h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend";
}

export default async function Home() {
  const user = await requireUser();
  const end = berlinDateTime(todayYmd(), "23:59");
  const tasks = await db.task.findMany({ where: { doneAt: null, dueAt: { lte: end } }, orderBy: { dueAt: "asc" }, take: 6 });
  const pending = await db.pendingAction.count({ where: { status: "PENDING", userId: user.id } });
  const events = await todayEvents();
  const winApp = await latestWindowsRelease();
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 md:py-10">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-brand-2 to-brand p-6 text-white md:p-10">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(125,211,252,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,.3)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.2em] text-sky-200 uppercase">{COMPANY.name} · Jarvis</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] md:text-5xl">
            {greeting()}, {firstName(user.name)}.
          </h1>
          <p className="mt-2 max-w-xl text-sky-100">Frag Jarvis nach Rechnungen, Mails, Terminen, Baustellen und Dokumenten – per Text oder Sprache.</p>
          <form action="/jarvis" className="mt-5 flex max-w-xl gap-2">
            <input name="q" placeholder="Was möchtest du wissen?" className="w-full rounded-full border border-white/20 bg-white/10 px-4 py-3 text-[16px] text-white outline-none placeholder:text-sky-200 focus:bg-white/15" aria-label="Frage an Jarvis" />
            <button className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-brand-2" aria-label="Fragen">
              <Sparkles className="size-5" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/jarvis?sprechen=1" className="chip border-white/30 bg-white/10 px-3 py-1 text-white">
              <Mic className="size-3.5" /> Sprechen
            </Link>
            <Link href="/jarvis?q=Was%20steht%20heute%20an%3F" className="chip border-white/30 bg-white/10 px-3 py-1 text-white">
              Tagesüberblick
            </Link>
          </div>
        </div>
      </section>

      <nav className="grid grid-cols-4 gap-3" aria-label="Schnellzugriff">
        {[
          { href: "/belege/foto", label: "Beleg fotografieren", icon: Camera },
          { href: "/projekte", label: "Stunden & Baustellen", icon: HardHat },
          { href: "/kalender", label: "Termin eintragen", icon: Calendar },
          { href: "/dokumente", label: "Dokument suchen", icon: FolderSearch },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="card flex flex-col items-center gap-2 p-3 text-center text-xs font-medium transition hover:border-brand md:flex-row md:p-4 md:text-left md:text-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><q.icon className="size-5" /></span>
            {q.label}
          </Link>
        ))}
      </nav>

      <WindowsAppBanner version={winApp?.version ?? null} size={winApp?.size ?? null} />

      {pending > 0 && (
        <Link href="/jarvis" className="card flex items-center gap-3 border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-warn">
          <AlertTriangle className="size-5" /> {pending === 1 ? "1 Freigabe wartet" : `${pending} Freigaben warten`} auf dich bei Jarvis.
          <ArrowRight className="ml-auto size-4" />
        </Link>
      )}

      <Suspense fallback={<div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-32 animate-pulse" />)}</div>}>
        <BookTiles />
      </Suspense>

      <Suspense fallback={<div className="card h-48 animate-pulse" />}>
        <BetriebOverview />
      </Suspense>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card min-w-0 p-5 md:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="size-5 text-brand" />
            <h2 className="font-bold">Termine heute</h2>
            <Link href="/kalender" className="ml-auto text-sm font-medium text-brand">Kalender</Link>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-steel">Heute keine Termine.</p>
          ) : (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex w-24 shrink-0 items-center gap-1 font-semibold text-brand"><Clock className="size-3.5" />{e.allDay ? "ganztägig" : `${timeHm(e.startAt)}${e.endAt ? `–${timeHm(e.endAt)}` : ""}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.title}</span>
                    {(e.location || e.project) && <span className="block truncate text-xs text-steel">{[e.location, e.project?.name].filter(Boolean).join(" · ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-2">
            <CheckSquare className="size-5 text-brand" />
            <h2 className="font-bold">Aufgaben heute</h2>
            <Link href="/aufgaben" className="ml-auto text-sm font-medium text-brand">Alle</Link>
          </div>
          {tasks.length === 0 ? (
            <p className="text-sm text-steel">Nichts fällig. 👍</p>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{t.title}</span>
                  <span className={t.dueAt && t.dueAt < new Date() ? "text-bad" : "text-steel"}>{t.dueHasTime ? formatDateTime(t.dueAt) : formatDate(t.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Suspense fallback={<div className="card h-48 animate-pulse" />}>
          <OverdueList />
        </Suspense>
      </div>
    </main>
  );
}

async function BookTiles() {
  const today = todayYmd();
  const [open, month, quotes] = await Promise.all([openInvoices(), revenue(`${today.slice(0, 7)}-01`, today), db.salesDoc.count({ where: { kind: "ANGEBOT", status: "OFFEN" } })]);
  const notDue = open.list.filter((d) => !isOverdue(d));
  const tiles = [
    { label: "Umsatz diesen Monat", value: fmtEuroCents(month.netCents), hint: `${month.count} Rechnungen (netto)`, icon: Wallet, href: "/buchhaltung", tone: "text-brand" },
    { label: "Überfällig", value: fmtEuroCents(open.overdueCents), hint: `${open.overdue.length} Rechnungen`, icon: AlertTriangle, href: "/buchhaltung/belege?art=rechnungen&status=ueberfaellig", tone: open.overdue.length ? "text-bad" : "text-ok" },
    { label: "Offen (noch nicht fällig)", value: fmtEuroCents(notDue.reduce((s, d) => s + d.grossCents - d.paidCents, 0)), hint: `${notDue.length} Rechnungen · ${quotes} offene Angebote`, icon: FileText, href: "/buchhaltung/belege?art=rechnungen&status=offen", tone: "text-ink" },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className="card p-5 transition hover:border-brand">
          <div className="flex items-center gap-2 text-sm font-medium text-steel">
            <t.icon className="size-4" /> {t.label}
          </div>
          <p className={`mt-2 text-3xl font-extrabold tracking-tight ${t.tone}`}>{t.value}</p>
          <p className="mt-1 text-xs text-steel">{t.hint}</p>
        </Link>
      ))}
    </div>
  );
}

async function OverdueList() {
  const { overdue } = await openInvoices();
  return (
    <section className="card min-w-0 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="size-5 text-bad" />
        <h2 className="font-bold">Überfällige Rechnungen</h2>
        <Link href="/buchhaltung/belege?art=rechnungen&status=ueberfaellig" className="ml-auto text-sm font-medium text-brand">Alle</Link>
      </div>
      {overdue.length === 0 ? (
        <p className="text-sm text-steel">Keine überfälligen Rechnungen. 🎉</p>
      ) : (
        <ul className="divide-y divide-line">
          {overdue.slice(0, 6).map((d) => (
            <li key={d.id}>
              <Link href={`/buchhaltung/beleg/${d.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{customerName(d)}</span>
                  <span className="text-xs text-steel">{d.number} · fällig {formatDate(d.dueDate)}</span>
                </span>
                <span className="shrink-0 font-semibold text-bad">{fmtEuroCents(d.grossCents - d.paidCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
