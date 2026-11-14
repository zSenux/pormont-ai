import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calculator, CalendarPlus, Clock, FileText, MapPin, NotebookPen, Pencil, Sparkles, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, formatDateTime, formatEuro, todayYmd } from "@/lib/berlin";
import { formatHours } from "@/lib/hours";
import { fileUrl, IMAGE_TYPES } from "@/lib/files";
import { timeHm } from "@/lib/calendar";
import { STATUS_LABEL, STATUS_TONE, type ProjectStatusKey } from "@/lib/projects";
import { addTime, deleteEvent, deleteFile, deleteNote, deleteTime, saveEvent, setProjectStatus, updateProject } from "@/app/actions/work";
import { ActionButton } from "@/components/confirm-button";
import { calcProject } from "@/lib/nachkalkulation";
import { Uploader } from "@/components/upload";
import { ProjectPlan } from "./plan";

export const dynamic = "force-dynamic";

const ymdOf = (d: Date | null) => (d ? berlinParts(d).ymd : "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await db.project.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: p?.name ?? "Projekt" };
}

export default async function ProjektDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const p = await db.project.findUnique({
    where: { id },
    include: {
      leader: { select: { name: true } },
      order: { select: { id: true, number: true } },
      customerRef: { select: { id: true, name: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 100, include: { file: { select: { id: true, name: true, mime: true } } } },
      times: { orderBy: [{ day: "desc" }, { createdAt: "desc" }], take: 200, include: { user: { select: { id: true, name: true } } } },
      events: { where: { startAt: { gte: new Date(Date.now() - 86400_000) } }, orderBy: { startAt: "asc" }, take: 20 },
      files: { where: { kind: { not: "foto" } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, mime: true, size: true, kind: true, createdAt: true, summary: true } },
    },
  });
  if (!p) notFound();
  const calc = await calcProject(p.id);
  const users = me.role === "ADMIN" ? await db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const total = p.times.reduce((s, t) => s + t.minutes, 0);
  const perUser = [...p.times.reduce((m, t) => m.set(t.user.name, (m.get(t.user.name) ?? 0) + t.minutes), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const status = p.status as ProjectStatusKey;
  const ask = (q: string) => `/jarvis?q=${encodeURIComponent(q)}`;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/projekte" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft className="size-4" /> Projekte
      </Link>

      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {p.order && <Link href={`/auftraege/${p.order.id}`} className="text-sm font-semibold text-brand">Auftrag {p.order.number}</Link>}
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            <p className="text-sm text-steel">
              {[p.customerRef ? undefined : p.customer, p.leader && `Projektleiter ${p.leader.name}`, p.startDate && `ab ${formatDate(p.startDate)}`, p.endDate && `bis ${formatDate(p.endDate)}`].filter(Boolean).join(" · ") || "Noch keine Eckdaten"}
            </p>
            {p.customerRef && <Link href={`/buchhaltung/kunden/${p.customerRef.id}`} className="block text-sm text-brand">{p.customerRef.name}</Link>}
            {p.address && (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(p.address)}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-brand">
                <MapPin className="size-4" /> {p.address}
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS_LABEL) as ProjectStatusKey[]).map((s) => (
              <ActionButton key={s} action={setProjectStatus.bind(null, p.id, s)} className={clsx("chip px-3 py-1 text-xs", s === status ? STATUS_TONE[s] : "bg-white text-steel")}>
                {STATUS_LABEL[s]}
              </ActionButton>
            ))}
          </div>
        </div>
        {p.description && <p className="whitespace-pre-line text-sm">{p.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Link href={ask(`Gib mir einen Stand zum Projekt „${p.name}“: letzte Einträge, Stunden, nächste Termine, offene Punkte.`)} className="btn-secondary">
            <Sparkles className="size-4" /> Stand von Jarvis
          </Link>
          <Link href={`/projekte/${p.id}/nachkalkulation`} className="btn-secondary">
            <Calculator className="size-4" /> Nachkalkulation
            <span className={clsx("text-xs font-semibold", calc.marginPct === null ? "text-steel" : calc.marginPct < 0 ? "text-bad" : calc.marginPct < 15 ? "text-warn" : "text-ok")}>
              {calc.marginPct !== null ? `${calc.marginPct.toLocaleString("de-DE", { maximumFractionDigits: 0 })} % Marge` : `Kosten ${formatEuro(calc.total)}`}
            </span>
          </Link>
          <details className="w-full">
            <summary className="btn-secondary inline-flex cursor-pointer list-none">
              <Pencil className="size-4" /> Bearbeiten
            </summary>
            <form action={updateProject.bind(null, p.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input name="name" required defaultValue={p.name} className="input sm:col-span-2" aria-label="Name" />
              <input name="customer" defaultValue={p.customer ?? ""} placeholder="Kunde" className="input" aria-label="Kunde" />
              <input name="address" defaultValue={p.address ?? ""} placeholder="Adresse" className="input" aria-label="Adresse" />
              <label className="text-xs text-steel">Beginn<input name="startDate" type="date" defaultValue={ymdOf(p.startDate)} className="input mt-1 w-full" /></label>
              <label className="text-xs text-steel">Ende<input name="endDate" type="date" defaultValue={ymdOf(p.endDate)} className="input mt-1 w-full" /></label>
              <textarea name="description" rows={3} defaultValue={p.description ?? ""} placeholder="Beschreibung" className="input resize-y sm:col-span-2" aria-label="Beschreibung" />
              <button className="btn-primary sm:col-span-2 sm:justify-self-end">Speichern</button>
            </form>
          </details>
        </div>
      </header>

      <ProjectPlan projectId={p.id} leaderId={p.leaderId} />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><NotebookPen className="size-4 text-brand" /> Baustellentagebuch</h2>
          <Uploader kind="foto" projectId={p.id} label="Foto aufnehmen" camera withNote />
          <ul className="space-y-3">
            {p.notes.length === 0 && <li className="text-sm text-steel">Noch keine Einträge. Fotos und Notizen landen hier mit Datum und Name.</li>}
            {p.notes.map((n) => (
              <li key={n.id} className="rounded-2xl border border-line p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-steel">
                  <span>{formatDateTime(n.createdAt)}{n.authorName && ` · ${n.authorName}`}</span>
                  <ActionButton action={deleteNote.bind(null, n.id)} confirm="Eintrag löschen?" className="text-steel/60 hover:text-bad" title="Löschen">
                    <Trash2 className="size-3.5" />
                  </ActionButton>
                </div>
                {n.file && IMAGE_TYPES.includes(n.file.mime) && (
                  <a href={fileUrl(n.file.id)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(n.file.id)} alt={n.text ?? n.file.name} loading="lazy" className="max-h-80 w-full rounded-xl object-cover" />
                  </a>
                )}
                {n.file && !IMAGE_TYPES.includes(n.file.mime) && <a href={fileUrl(n.file.id)} className="text-sm text-brand">{n.file.name}</a>}
                {n.text && <p className="mt-1 whitespace-pre-line text-sm">{n.text}</p>}
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-5">
          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Clock className="size-4 text-brand" /> Stunden <span className="ml-auto text-sm font-normal text-steel">gesamt {formatHours(total)}</span></h2>
            <form action={addTime} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="projectId" value={p.id} />
              <input name="day" type="date" required defaultValue={todayYmd()} className="input" aria-label="Tag" />
              <input name="hours" required pattern="\d{1,2}([.,:]\d{1,2})?\s*(h|min)?" title="z. B. 7,5 oder 7:30" placeholder="Stunden, z. B. 7,5" inputMode="decimal" className="input" aria-label="Stunden" />
              {users.length > 0 && (
                <select name="userId" defaultValue={me.id} className="input col-span-2" aria-label="Mitarbeiter">
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              <input name="note" placeholder="Was? (optional)" className="input col-span-2" aria-label="Tätigkeit" />
              <button className="btn-primary col-span-2">Stunden eintragen</button>
            </form>
            {perUser.length > 0 && (
              <p className="text-xs text-steel">{perUser.map(([n, m]) => `${n}: ${formatHours(m)}`).join(" · ")}</p>
            )}
            <ul className="divide-y divide-line text-sm">
              {p.times.slice(0, 30).map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <span className="w-20 shrink-0 text-steel">{formatDate(t.day).slice(0, 6)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.user.name}{t.note && <span className="text-steel"> · {t.note}</span>}</span>
                  <span className="font-medium">{formatHours(t.minutes)}</span>
                  {(t.user.id === me.id || me.role === "ADMIN") && (
                    <ActionButton action={deleteTime.bind(null, t.id)} confirm="Eintrag löschen?" className="text-steel/60 hover:text-bad" title="Löschen">
                      <Trash2 className="size-3.5" />
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold"><CalendarPlus className="size-4 text-brand" /> Termine</h2>
            <ul className="space-y-2 text-sm">
              {p.events.length === 0 && <li className="text-steel">Keine anstehenden Termine.</li>}
              {p.events.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="w-28 shrink-0 text-steel">{formatDate(e.startAt).slice(0, 6)} {e.allDay ? "" : timeHm(e.startAt)}</span>
                  <span className="min-w-0 flex-1">{e.title}</span>
                  <ActionButton action={deleteEvent.bind(null, e.id)} confirm="Termin löschen?" className="text-steel/60 hover:text-bad" title="Löschen">
                    <Trash2 className="size-3.5" />
                  </ActionButton>
                </li>
              ))}
            </ul>
            <form action={saveEvent} className="grid grid-cols-3 gap-2">
              <input type="hidden" name="projectId" value={p.id} />
              {p.address && <input type="hidden" name="location" value={p.address} />}
              <input name="title" required placeholder="Termin, z. B. Montage" className="input col-span-3" aria-label="Termin" />
              <input name="date" type="date" required defaultValue={todayYmd()} className="input col-span-2" aria-label="Datum" />
              <input name="from" type="time" className="input" aria-label="Uhrzeit" />
              <button className="btn-secondary col-span-3">Termin eintragen</button>
            </form>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-brand" /> Dokumente</h2>
            <Uploader kind="dokument" projectId={p.id} label="Dokument hochladen" hint="PDF, Pläne, Fotos" />
            <ul className="divide-y divide-line text-sm">
              {p.files.length === 0 && <li className="py-1 text-steel">Noch keine Dokumente.</li>}
              {p.files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-2">
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand">{f.name}</a>
                  <span className="text-xs text-steel">{formatDate(f.createdAt)}</span>
                  <ActionButton action={deleteFile.bind(null, f.id)} confirm={`„${f.name}“ löschen?`} className="text-steel/60 hover:text-bad" title="Löschen">
                    <Trash2 className="size-3.5" />
                  </ActionButton>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
