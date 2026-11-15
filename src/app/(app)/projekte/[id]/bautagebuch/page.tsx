import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, CloudSun, FileDown, Trash2, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { crewSuggestion, fmtHours, readCrew } from "@/lib/bautagebuch";
import { deleteDiaryEntry, diaryWeather } from "@/app/actions/bautagebuch";
import { ActionButton } from "@/components/confirm-button";
import { DiaryForm } from "@/components/diary-form";
import { Uploader } from "@/components/upload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bautagebuch" };

const WD = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" });

export default async function Bautagebuch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tag?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayYmd();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.tag ?? "") && sp.tag! <= today ? sp.tag! : today;
  const p = await db.project.findUnique({ where: { id }, select: { id: true, name: true, address: true, customer: true } });
  if (!p) notFound();
  const [entries, users, current] = await Promise.all([
    db.diaryEntry.findMany({ where: { projectId: id }, orderBy: { day: "desc" }, take: 60, include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } } } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.diaryEntry.findUnique({ where: { projectId_day: { projectId: id, day: berlinDateTime(day) } }, include: { files: { select: { id: true, name: true } } } }),
  ]);
  const suggestion = current ? [] : await crewSuggestion(id, day);
  const first = entries.at(-1);
  const ymd = (d: Date) => berlinParts(d).ymd;

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <Link href={`/projekte/${p.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> {p.name}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Bautagebuch</h1>
          <p className="mt-1 text-sm text-steel">{p.name}{p.address && ` · ${p.address}`}. Das Wetter holt Jarvis automatisch beim Wetterdienst Open-Meteo für den Ort der Baustelle.</p>
        </div>
        <form action={`/api/bautagebuch/${p.id}`} target="_blank" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-steel">Von<input type="date" name="von" defaultValue={first ? ymd(first.day) : addDaysYmd(today, -30)} className="input mt-1 w-36 py-1.5" /></label>
          <label className="text-xs text-steel">Bis<input type="date" name="bis" defaultValue={today} className="input mt-1 w-36 py-1.5" /></label>
          <button className="btn-primary"><FileDown className="size-4" /> PDF für Bauherrn</button>
        </form>
      </div>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <Link href={`?tag=${addDaysYmd(day, -1)}`} className="btn-secondary px-2" aria-label="Tag zurück"><ChevronLeft className="size-4" /></Link>
          <h2 className="text-center font-semibold">{WD.format(berlinDateTime(day, "12:00"))}, {formatDate(berlinDateTime(day, "12:00"))}{day === today && " (heute)"}</h2>
          {day < today ? <Link href={`?tag=${addDaysYmd(day, 1)}`} className="btn-secondary px-2" aria-label="Tag vor"><ChevronRight className="size-4" /></Link> : <span className="w-9" />}
        </div>
        {current?.weather && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft p-3 text-sm text-brand-2">
            <CloudSun className="size-4" /> {current.weather}
            <span className="text-xs text-steel">({current.weatherSource === "open-meteo" ? "Wetterdienst" : "von Hand"})</span>
            <ActionButton action={diaryWeather.bind(null, current.id)} className="ml-auto text-xs font-medium text-brand">neu holen</ActionButton>
          </p>
        )}
        <DiaryForm key={day} projectId={p.id} day={day} users={users} suggestion={suggestion} entry={current ? { weather: current.weather, crew: readCrew(current.crew), work: current.work, material: current.material, obstacles: current.obstacles, visitors: current.visitors } : null} />
        {current ? (
          <div className="space-y-2 border-t border-line pt-4">
            <h3 className="text-sm font-semibold">Fotos des Tages</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {current.files.map((f) => (
                <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f.id)} alt={f.name} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                </a>
              ))}
            </div>
            <Uploader kind="foto" diaryId={current.id} label="Foto aufnehmen" camera accept="image/*" hint="Die ersten 6 Fotos je Tag kommen ins PDF." />
          </div>
        ) : (
          <p className="text-xs text-steel">Nach dem Speichern kannst du Fotos zum Tag hinzufügen.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Bisherige Einträge ({entries.length})</h2>
        {entries.length === 0 && <p className="card p-5 text-sm text-steel">Noch keine Einträge. Am besten jeden Abend kurz ausfüllen – oder Jarvis sagen: „Bautagebuch Käfertal: Podest montiert, Sven und Mehmet je 8 Stunden.“</p>}
        {entries.map((e) => {
          const crew = readCrew(e.crew);
          const hrs = crew.reduce((s, c) => s + (c.hours ?? 0), 0);
          return (
            <article key={e.id} className={clsx("card space-y-1.5 p-4 text-sm", ymd(e.day) === day && "border-brand")}>
              <div className="flex items-center justify-between gap-2">
                <Link href={`?tag=${ymd(e.day)}`} className="font-semibold text-brand">{WD.format(e.day)}, {formatDate(e.day)}</Link>
                <span className="flex items-center gap-2 text-xs text-steel">
                  {e.authorName}
                  <ActionButton action={deleteDiaryEntry.bind(null, e.id)} confirm="Eintrag löschen?" className="text-steel/60 hover:text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
                </span>
              </div>
              {e.weather && <p className="flex items-center gap-1.5 text-steel"><CloudSun className="size-4" /> {e.weather}</p>}
              {crew.length > 0 && <p className="flex items-center gap-1.5 text-steel"><Users className="size-4" /> {crew.map((c) => `${c.name}${c.hours ? ` ${fmtHours(c.hours)}` : ""}`).join(", ")}{hrs ? ` · ${fmtHours(hrs)}` : ""}</p>}
              {e.work && <p className="whitespace-pre-line"><strong>Arbeiten:</strong> {e.work}</p>}
              {e.material && <p className="whitespace-pre-line"><strong>Material:</strong> {e.material}</p>}
              {e.obstacles && <p className="whitespace-pre-line text-warn"><strong>Behinderungen:</strong> {e.obstacles}</p>}
              {e.visitors && <p className="whitespace-pre-line"><strong>Besucher/Anordnungen:</strong> {e.visitors}</p>}
              {e.files.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pt-1">
                  {e.files.slice(0, 8).map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={f.id} src={fileUrl(f.id)} alt={f.name} loading="lazy" className="size-20 shrink-0 rounded-lg object-cover" />
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
