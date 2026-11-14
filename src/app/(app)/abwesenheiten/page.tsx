import Link from "next/link";
import { CalendarDays, Check, ChevronLeft, ChevronRight, FileCheck2, Palmtree, X } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { absenceCovers, absencesBetween, defaultVacationDays, vacationBalance } from "@/lib/abwesenheit";
import { ABS_KIND_CELL, ABS_KIND_LABEL, ABS_KIND_SHORT, ABS_KINDS, ABS_STATUS_LABEL, ABS_STATUS_TONE, daysBetween, fmtDays, holidayName, isWorkday, weekdayOf, type AbsKind, type AbsStatus } from "@/lib/abwesenheit-shared";
import { approveAbsence, cancelAbsenceAction, newAbsence, rejectAbsence, setCertificate, setVacationDays } from "@/app/actions/abwesenheit";
import { StateForm } from "@/components/state-form";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Urlaub & Krank" };
export const dynamic = "force-dynamic";

const monday = (ymd: string) => addDaysYmd(ymd, -((weekdayOf(ymd) + 6) % 7));
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const when = (a: { from: Date; to: Date; halfDay: boolean }) => (a.from.getTime() === a.to.getTime() ? `${formatDate(a.from)}${a.halfDay ? " (halber Tag)" : ""}` : `${formatDate(a.from)} – ${formatDate(a.to)}`);

export default async function Abwesenheiten({ searchParams }: { searchParams: Promise<{ ab?: string }> }) {
  const me = await requireUser();
  const admin = me.role === "ADMIN";
  const sp = await searchParams;
  const today = todayYmd();
  const start = monday(/^\d{4}-\d{2}-\d{2}$/.test(sp.ab ?? "") ? sp.ab! : today);
  const end = addDaysYmd(start, 27);
  const days = daysBetween(start, end);
  const year = Number(today.slice(0, 4));
  const [users, plan, mine, pending, balance] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, vacationDays: true } }),
    absencesBetween(start, end),
    db.absence.findMany({ where: { userId: me.id, OR: [{ to: { gte: new Date(Date.UTC(year, 0, 1)) } }, { status: "BEANTRAGT" }] }, orderBy: { from: "desc" }, take: 40 }),
    admin ? db.absence.findMany({ where: { status: "BEANTRAGT" }, orderBy: { from: "asc" }, include: { user: { select: { name: true } } } }) : Promise.resolve([]),
    vacationBalance(me.id, year),
  ]);
  const balances = admin ? await Promise.all(users.map(async (u) => ({ ...u, b: await vacationBalance(u.id, year) }))) : [];
  const absentToday = plan.filter((a) => a.status === "GENEHMIGT" && absenceCovers(a, today));
  // Krankheit ist Gesundheitsdatum: Kollegen sehen nur „abwesend“
  const shownKind = (a: { kind: string; userId: string }): AbsKind => (a.kind === "KRANK" && !admin && a.userId !== me.id ? "SONSTIGES" : (a.kind as AbsKind));

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Urlaub & Krank</h1>
          <p className="mt-1 text-sm text-steel">Urlaub beantragen, krank melden, sehen wer fehlt. Genehmigte Tage landen automatisch in der Stundenliste. Oder Jarvis sagen: „Ich bin heute krank.“</p>
        </div>
        <Link href="/kalender" className="btn-secondary"><CalendarDays className="size-4" /> Kalender</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Palmtree className="size-4 text-brand" /> Mein Urlaub {year}</h2>
          <p><strong className="text-4xl font-extrabold text-brand">{balance.rest.toLocaleString("de-DE")}</strong> <span className="text-steel">Tage übrig</span></p>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-steel">Anspruch</dt><dd className="text-right">{fmtDays(balance.entitlement)}</dd>
            <dt className="text-steel">Genehmigt</dt><dd className="text-right">{fmtDays(balance.approved)}</dd>
            <dt className="text-steel">Beantragt</dt><dd className="text-right">{fmtDays(balance.requested)}</dd>
            <dt className="text-steel">Rest nach Anträgen</dt><dd className={clsx("text-right font-semibold", balance.restAfter < 0 && "text-bad")}>{fmtDays(balance.restAfter)}</dd>
          </dl>
          <p className="text-xs text-steel">Gezählt werden Arbeitstage Mo–Fr ohne Feiertage in Baden-Württemberg.</p>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Eintragen</h2>
          <StateForm action={newAbsence} reset className="grid gap-2 sm:grid-cols-4 sm:[&>div:last-child]:col-span-4" submit="Absenden">
            <select name="kind" className="input sm:col-span-2" aria-label="Art" defaultValue="URLAUB">
              {ABS_KINDS.map((k) => <option key={k} value={k}>{ABS_KIND_LABEL[k]}</option>)}
            </select>
            {admin ? (
              <select name="userId" className="input sm:col-span-2" aria-label="Mitarbeiter" defaultValue={me.id}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (ich)` : u.name}</option>)}
              </select>
            ) : <span className="hidden sm:col-span-2 sm:block" />}
            <label className="text-xs text-steel">Von <input name="from" type="date" required defaultValue={today} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Bis <input name="to" type="date" className="input mt-1 w-full" /></label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="halfDay" className="size-4 accent-brand" /> halber Tag</label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="certificate" className="size-4 accent-brand" /> AU liegt vor</label>
            <input name="note" placeholder="Bemerkung (optional, z. B. Vertretung: Sven)" className="input sm:col-span-4" aria-label="Bemerkung" />
            <p className="text-xs text-steel sm:col-span-4">„Bis“ leer = ein Tag. Krankmeldungen gelten sofort{admin ? ", Einträge vom Admin sind direkt genehmigt" : ", Urlaub genehmigt die Geschäftsführung"}.</p>
          </StateForm>
        </section>
      </div>

      {admin && pending.length > 0 && (
        <section className="card border-warn/40 p-5">
          <h2 className="font-semibold">Offene Anträge ({pending.length})</h2>
          <ul className="mt-2 divide-y divide-line">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.user.name} · {ABS_KIND_SHORT[a.kind as AbsKind]} {when(a)}</p>
                  <p className="text-xs text-steel">{a.halfDay ? "halber Tag" : fmtDays(a.days)}{a.note && ` · „${a.note}“`} · beantragt {formatDate(a.createdAt)}</p>
                </div>
                <ActionButton action={approveAbsence.bind(null, a.id)} className="btn-primary px-3 py-1.5"><Check className="size-4" /> Genehmigen</ActionButton>
                <form action={rejectAbsence.bind(null, a.id)} className="flex gap-1">
                  <input name="note" placeholder="Grund (optional)" className="input w-40 py-1.5 text-xs" aria-label={`Ablehnungsgrund ${a.user.name}`} />
                  <button className="btn-secondary px-3 py-1.5 text-bad"><X className="size-4" /> Ablehnen</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Team-Plan · {formatDate(new Date(`${start}T12:00:00Z`))} – {formatDate(new Date(`${end}T12:00:00Z`))}</h2>
          <div className="flex gap-1">
            <Link href={`/abwesenheiten?ab=${addDaysYmd(start, -28)}`} className="btn-secondary px-2" aria-label="Zurück"><ChevronLeft className="size-4" /></Link>
            <Link href="/abwesenheiten" className="btn-secondary">Heute</Link>
            <Link href={`/abwesenheiten?ab=${addDaysYmd(start, 28)}`} className="btn-secondary px-2" aria-label="Weiter"><ChevronRight className="size-4" /></Link>
          </div>
        </div>
        <p className="text-sm">
          {absentToday.length ? <>Heute fehlen: {absentToday.map((a) => `${a.user.name} (${ABS_KIND_SHORT[shownKind(a)]})`).join(", ")}</> : <span className="text-steel">Heute sind alle da.</span>}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white p-1 text-left font-semibold">Mitarbeiter</th>
                {days.map((d) => {
                  const off = !isWorkday(d);
                  return (
                    <th key={d} title={holidayName(d) ?? undefined} className={clsx("w-7 p-0.5 text-center font-normal", off ? "text-steel/60" : "text-steel", d === today && "font-bold text-brand")}>
                      <span className="block">{WD[weekdayOf(d)]}</span>
                      <span className="block">{Number(d.slice(8))}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky left-0 truncate bg-white py-1 pr-2 font-medium">{u.name}</td>
                  {days.map((d) => {
                    const a = plan.find((x) => x.userId === u.id && absenceCovers(x, d));
                    const off = !isWorkday(d);
                    const k = a ? shownKind(a) : null;
                    return (
                      <td key={d} className="p-0.5">
                        <div
                          title={a ? `${u.name}: ${ABS_KIND_SHORT[k!]}${a.status === "BEANTRAGT" ? " (beantragt)" : ""}` : (holidayName(d) ?? undefined)}
                          className={clsx("h-6 rounded", a && !off ? ABS_KIND_CELL[k!] : off ? "bg-mist" : "border border-line", a && a.status === "BEANTRAGT" && "opacity-45", d === today && "ring-2 ring-brand/50")}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex flex-wrap gap-4 text-xs text-steel">
          <span className="flex items-center gap-1"><i className="size-3 rounded bg-brand" /> Urlaub</span>
          {admin && <span className="flex items-center gap-1"><i className="size-3 rounded bg-bad" /> Krank</span>}
          <span className="flex items-center gap-1"><i className="size-3 rounded bg-steel" /> {admin ? "Sonstiges" : "Abwesend"}</span>
          <span className="flex items-center gap-1"><i className="size-3 rounded bg-brand opacity-45" /> beantragt</span>
          <span className="flex items-center gap-1"><i className="size-3 rounded bg-mist" /> Wochenende/Feiertag</span>
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Meine Einträge</h2>
        {mine.length === 0 && <p className="mt-2 text-sm text-steel">Noch nichts eingetragen.</p>}
        <ul className="mt-2 divide-y divide-line">
          {mine.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{ABS_KIND_SHORT[a.kind as AbsKind]} {when(a)} <span className="font-normal text-steel">· {a.halfDay ? "halber Tag" : fmtDays(a.days)}</span></p>
                {(a.note || a.decisionNote) && <p className="text-xs text-steel">{a.note}{a.decisionNote && ` · Antwort: ${a.decisionNote}`}</p>}
              </div>
              <span className={clsx("chip", ABS_STATUS_TONE[a.status as AbsStatus])}>{ABS_STATUS_LABEL[a.status as AbsStatus]}</span>
              {(a.status === "BEANTRAGT" || (a.status === "GENEHMIGT" && (a.kind === "KRANK" || berlinParts(a.from).ymd > today))) && (
                <ActionButton action={cancelAbsenceAction.bind(null, a.id)} confirm="Wirklich stornieren?" className="btn-secondary px-3 py-1 text-xs">Stornieren</ActionButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      {admin && (
        <>
          <section className="card p-5">
            <h2 className="font-semibold">Team im Plan-Zeitraum</h2>
            <ul className="mt-2 divide-y divide-line">
              {plan.length === 0 && <li className="py-2 text-sm text-steel">Keine Abwesenheiten.</li>}
              {plan.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><b>{a.user.name}</b> · {ABS_KIND_SHORT[a.kind as AbsKind]} {when(a)} <span className="text-steel">· {a.halfDay ? "halber Tag" : fmtDays(a.days)}</span></span>
                  {a.kind === "KRANK" && (
                    <ActionButton action={setCertificate.bind(null, a.id)} className={clsx("chip", a.certificate ? "border-ok/30 bg-green-50 text-ok" : "border-warn/30 bg-amber-50 text-warn")} title="AU-Bescheinigung umschalten">
                      <FileCheck2 className="size-3.5" /> {a.certificate ? "AU liegt vor" : "AU fehlt"}
                    </ActionButton>
                  )}
                  <span className={clsx("chip", ABS_STATUS_TONE[a.status as AbsStatus])}>{ABS_STATUS_LABEL[a.status as AbsStatus]}</span>
                  <ActionButton action={cancelAbsenceAction.bind(null, a.id)} confirm={`Eintrag von ${a.user.name} stornieren?`} className="text-xs text-steel hover:text-bad">Stornieren</ActionButton>
                </li>
              ))}
            </ul>
          </section>
          <details className="card p-5">
            <summary className="cursor-pointer font-semibold">Urlaubskonten {year} & Anspruch</summary>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-steel"><tr><th className="py-1">Mitarbeiter</th><th className="text-right">Genehmigt</th><th className="text-right">Beantragt</th><th className="text-right">Rest</th><th className="text-right">Anspruch/Jahr</th></tr></thead>
              <tbody className="divide-y divide-line">
                {balances.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 font-medium">{u.name}</td>
                    <td className="text-right">{u.b.approved.toLocaleString("de-DE")}</td>
                    <td className="text-right">{u.b.requested.toLocaleString("de-DE")}</td>
                    <td className={clsx("text-right font-semibold", u.b.rest < 0 && "text-bad")}>{u.b.rest.toLocaleString("de-DE")}</td>
                    <td className="text-right">
                      <form action={setVacationDays.bind(null, u.id)} className="inline-flex items-center gap-1">
                        <input name="days" inputMode="numeric" defaultValue={u.vacationDays ?? ""} placeholder={String(defaultVacationDays())} className="input w-16 py-1 text-right text-xs" aria-label={`Urlaubsanspruch ${u.name}`} />
                        <button className="btn-secondary px-2 py-1 text-xs">OK</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-steel">Leer = Standard ({defaultVacationDays()} Tage, änderbar über URLAUB_TAGE). Resturlaub aus dem Vorjahr bitte im Anspruch mit einrechnen.</p>
          </details>
        </>
      )}
    </main>
  );
}
