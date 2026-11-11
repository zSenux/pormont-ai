import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, MapPin, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinParts, todayYmd } from "@/lib/berlin";
import { eventsBetween, timeHm } from "@/lib/calendar";
import { deleteEvent, saveEvent } from "@/app/actions/work";
import { ActionButton } from "@/components/confirm-button";
import { icsUrl } from "@/lib/ics";
import { CopyLink } from "./copy-link";

export const metadata = { title: "Kalender" };
export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

/** Montag der Woche von ymd */
function monday(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysYmd(ymd, -wd);
}

export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ woche?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayYmd();
  const start = monday(/^\d{4}-\d{2}-\d{2}$/.test(sp.woche ?? "") ? sp.woche! : today);
  const end = addDaysYmd(start, 6);
  const [events, projects] = await Promise.all([eventsBetween(start, end), db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
  const byDay = new Map(days.map((d) => [d, events.filter((e) => berlinParts(e.startAt).ymd === d)]));
  const kw = (() => {
    const [y, m, d] = addDaysYmd(start, 3).split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  })();

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Kalender</h1>
          <p className="mt-1 text-sm text-steel">Oder Jarvis sagen: „Trag Montag 8 Uhr Aufmaß bei Müller ein.“</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/kalender?woche=${addDaysYmd(start, -7)}`} className="btn-secondary px-3" aria-label="Vorige Woche">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href="/kalender" className="btn-secondary">KW {kw}</Link>
          <Link href={`/kalender?woche=${addDaysYmd(start, 7)}`} className="btn-secondary px-3" aria-label="Nächste Woche">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      <details className="card p-4" open={events.length === 0}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold">
          <CalendarPlus className="size-4 text-brand" /> Termin eintragen
        </summary>
        <form action={saveEvent} className="mt-3 grid gap-2 sm:grid-cols-6">
          <input name="title" required placeholder="Was? z. B. Aufmaß Treppe Müller" className="input sm:col-span-6" aria-label="Titel" />
          <input name="date" type="date" required defaultValue={days.includes(today) ? today : start} className="input sm:col-span-2" aria-label="Datum" />
          <input name="from" type="time" className="input sm:col-span-1" aria-label="Von" />
          <input name="to" type="time" className="input sm:col-span-1" aria-label="Bis" />
          <select name="remind" defaultValue="30" className="input sm:col-span-2" aria-label="Erinnerung">
            <option value="0">Keine Erinnerung</option>
            <option value="15">15 min vorher</option>
            <option value="30">30 min vorher</option>
            <option value="60">1 Std. vorher</option>
            <option value="1440">1 Tag vorher</option>
          </select>
          <input name="location" placeholder="Ort / Adresse" className="input sm:col-span-3" aria-label="Ort" />
          <select name="projectId" className="input sm:col-span-3" aria-label="Projekt" defaultValue="">
            <option value="">Ohne Projekt</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <textarea name="notes" rows={2} placeholder="Notiz (optional)" className="input resize-y sm:col-span-6" aria-label="Notiz" />
          <p className="text-xs text-steel sm:col-span-4">Ohne Uhrzeit = ganztägig.</p>
          <button className="btn-primary sm:col-span-2">Speichern</button>
        </form>
      </details>

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const isToday = d === today;
          const [y, m, dd] = d.split("-").map(Number);
          return (
            <section key={d} className={clsx("card min-h-28 p-3", isToday && "border-brand ring-1 ring-brand", list.length === 0 && "max-md:hidden")}>
              <h2 className={clsx("mb-2 text-xs font-semibold uppercase tracking-wide", isToday ? "text-brand" : "text-steel")}>
                {DAY.format(new Date(Date.UTC(y, m - 1, dd)))}
                {isToday && " · heute"}
              </h2>
              <ul className="space-y-2">
                {list.length === 0 && <li className="text-xs text-steel/70">frei</li>}
                {list.map((e) => (
                  <li key={e.id} className="group rounded-xl border border-line bg-mist/60 p-2 text-sm">
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-semibold text-brand">{e.allDay ? "ganztägig" : `${timeHm(e.startAt)}${e.endAt ? `–${timeHm(e.endAt)}` : ""}`}</span>
                      <ActionButton action={deleteEvent.bind(null, e.id)} confirm={`Termin „${e.title}“ löschen?`} className="text-steel/60 hover:text-bad" title="Löschen">
                        <Trash2 className="size-3.5" />
                      </ActionButton>
                    </div>
                    <p className="font-medium leading-snug [overflow-wrap:anywhere]">{e.title}</p>
                    {e.location && (
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-steel hover:text-brand">
                        <MapPin className="size-3" /> {e.location}
                      </a>
                    )}
                    {e.project && <Link href={`/projekte/${e.project.id}`} className="mt-1 block rounded-md border border-brand/20 bg-brand-soft px-1.5 py-0.5 text-[11px] leading-tight font-medium text-brand">{e.project.name}</Link>}
                    {e.notes && <p className="mt-1 whitespace-pre-line text-xs text-steel">{e.notes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {events.length === 0 && <p className="text-center text-sm text-steel md:hidden">Diese Woche keine Termine.</p>}

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-semibold">Im iPhone-, Outlook- oder Google-Kalender anzeigen</h2>
        <p className="text-steel">Kalender-Abo einrichten (nur lesen): iPhone → Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → „Kalenderabo hinzufügen“ und diesen Link einfügen.</p>
        <CopyLink url={await icsUrl()} />
      </section>
    </main>
  );
}
