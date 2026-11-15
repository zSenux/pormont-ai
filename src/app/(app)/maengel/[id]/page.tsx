import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Hammer, RotateCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, formatDateTime, todayYmd } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { sourceLabel, warrantyOf } from "@/lib/maengel";
import { DEFECT_OPEN, DEFECT_STATUS_LABEL, DEFECT_TONE, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, SOURCE_LABEL, SOURCES, type DefectStatus, type Severity } from "@/lib/maengel-shared";
import { changeDefectStatus, editDefect, updateDefectAssign } from "@/app/actions/maengel";
import { ActionButton } from "@/components/confirm-button";
import { Uploader } from "@/components/upload";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await db.defect.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: d ? `Mangel ${d.number}` : "Mangel" };
}

const ymdOf = (d: Date | null) => (d ? berlinParts(d).ymd : "");

export default async function MangelDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { neu } = await searchParams;
  const d = await db.defect.findUnique({
    where: { id },
    include: { project: { select: { id: true, name: true, address: true, leader: { select: { name: true } } } }, assignee: { select: { id: true, name: true } }, files: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, mime: true, meta: true, uploadedBy: true, createdAt: true } } },
  });
  if (!d) notFound();
  const [users, w] = await Promise.all([db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), warrantyOf(d.projectId)]);
  const status = d.status as DefectStatus;
  const open = DEFECT_OPEN.includes(status);
  const overdue = open && d.dueDate && berlinParts(d.dueDate).ymd < todayYmd();
  const phase = (m: unknown) => ((m as { phase?: string } | null)?.phase === "nachher" ? "nachher" : "vorher");
  const photos = { vorher: d.files.filter((f) => phase(f.meta) === "vorher"), nachher: d.files.filter((f) => phase(f.meta) === "nachher") };

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href={`/maengel?projekt=${d.projectId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Mängel</Link>

      {neu && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-ok">Mangel {d.number} angelegt – jetzt ein Foto machen.</p>}

      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-steel">{d.number} · <Link href={`/projekte/${d.projectId}`} className="text-brand">{d.project.name}</Link></p>
            <h1 className="text-2xl font-bold tracking-tight">{d.title}</h1>
            <p className="text-sm text-steel">
              {d.location && `${d.location} · `}<span className={SEVERITY_TONE[d.severity as Severity]}>Schwere {SEVERITY_LABEL[d.severity as Severity]}</span> · {sourceLabel(d.source)} · gemeldet {formatDateTime(d.createdAt)}{d.reportedBy && ` von ${d.reportedBy}`}
            </p>
          </div>
          <span className={clsx("chip px-3 py-1 text-sm", DEFECT_TONE[status])}>{DEFECT_STATUS_LABEL[status]}</span>
        </div>
        {d.description && <p className="whitespace-pre-line text-sm">{d.description}</p>}
        <p className={clsx("text-sm", overdue ? "font-semibold text-bad" : "text-steel")}>
          Zuständig: {d.assignee?.name ?? `Projektleitung${d.project.leader ? ` (${d.project.leader.name})` : ""}`}{d.dueDate && ` · Frist ${formatDate(d.dueDate)}${overdue ? " – überfällig" : ""}`}
        </p>
        {(d.warranty || w.until) && (
          <p className="flex items-center gap-1.5 text-sm text-steel"><ShieldCheck className="size-4 text-brand" />{d.warranty ? "Gewährleistungsfall · " : ""}{w.acceptedAt ? `Abnahme ${formatDate(w.acceptedAt)} · ` : ""}{w.until ? `Gewährleistung bis ${formatDate(w.until)}${w.active ? "" : " (abgelaufen)"}` : "Noch nicht abgenommen"}</p>
        )}
        {d.fixedAt && <p className="text-sm text-ok">Behoben {formatDateTime(d.fixedAt)}{d.fixedBy && ` von ${d.fixedBy}`}{d.closedAt && ` · abgehakt ${formatDateTime(d.closedAt)}${d.closedBy ? ` von ${d.closedBy}` : ""}`}</p>}
        {d.fixNote && <p className="whitespace-pre-line rounded-xl bg-mist p-3 text-sm">{d.fixNote}</p>}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {status === "OFFEN" && <ActionButton action={changeDefectStatus.bind(null, d.id, "IN_ARBEIT", undefined)} className="btn-secondary"><Hammer className="size-4" /> Ich kümmere mich</ActionButton>}
          {open && status !== "BEHOBEN" && (
            <form action={changeDefectStatus.bind(null, d.id, "BEHOBEN")} className="flex w-full flex-wrap gap-2 sm:w-auto">
              <input name="note" placeholder="Was wurde gemacht? (optional)" className="input min-w-0 flex-1 sm:w-64" aria-label="Was wurde gemacht" />
              <button className="btn-primary"><Check className="size-4" /> Behoben</button>
            </form>
          )}
          {status === "BEHOBEN" && (
            <>
              <ActionButton action={changeDefectStatus.bind(null, d.id, "ERLEDIGT", undefined)} className="btn-primary"><Check className="size-4" /> Geprüft – abhaken</ActionButton>
              <ActionButton action={changeDefectStatus.bind(null, d.id, "IN_ARBEIT", undefined)} className="btn-secondary"><RotateCcw className="size-4" /> Nicht behoben</ActionButton>
            </>
          )}
          {open && <ActionButton action={changeDefectStatus.bind(null, d.id, "ABGELEHNT", undefined)} confirm="Als „kein Mangel“ schließen?" className="btn-secondary text-steel"><X className="size-4" /> Kein Mangel</ActionButton>}
          {!open && <ActionButton action={changeDefectStatus.bind(null, d.id, "OFFEN", undefined)} className="btn-secondary"><RotateCcw className="size-4" /> Wieder öffnen</ActionButton>}
          <Link href={`/jarvis?q=${encodeURIComponent(`Formuliere eine kurze, sachliche Mail an den Kunden zum Mangel ${d.number} „${d.title}“ (${d.project.name}): Stand ${DEFECT_STATUS_LABEL[status]}${d.dueDate ? `, Frist ${formatDate(d.dueDate)}` : ""}. Nur als Entwurf.`)}`} className="btn-secondary"><Sparkles className="size-4" /> Kunden informieren</Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {(["vorher", "nachher"] as const).map((ph) => (
          <div key={ph} className="card space-y-3 p-4">
            <h2 className="font-semibold">{ph === "vorher" ? "Foto Mangel" : "Foto nach Beseitigung"}</h2>
            <div className="grid grid-cols-2 gap-2">
              {photos[ph].map((f) => (
                <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" title={`${f.uploadedBy ?? ""} ${formatDateTime(f.createdAt)}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f.id)} alt={f.name} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                </a>
              ))}
            </div>
            {photos[ph].length === 0 && <p className="text-xs text-steel">Noch kein Foto.</p>}
            <Uploader kind="foto" defectId={d.id} phase={ph} label={ph === "vorher" ? "Mangel fotografieren" : "Ergebnis fotografieren"} camera accept="image/*" />
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Zuweisen & Frist</h2>
        <form action={updateDefectAssign.bind(null, d.id)} className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
          <select name="assigneeId" defaultValue={d.assignee?.id ?? ""} className="input" aria-label="Zuständig">
            <option value="">Projektleitung</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="date" name="dueDate" defaultValue={ymdOf(d.dueDate)} className="input" aria-label="Frist" />
          <button className="btn-secondary">Speichern</button>
        </form>
      </section>

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">Bearbeiten</summary>
        <form action={editDefect.bind(null, d.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="title" required defaultValue={d.title} className="input sm:col-span-2" aria-label="Mangel" />
          <input name="location" defaultValue={d.location ?? ""} placeholder="Ort/Bauteil" className="input" aria-label="Ort" />
          <select name="severity" defaultValue={d.severity} className="input" aria-label="Schwere">{SEVERITIES.map((s) => <option key={s} value={s}>Schwere: {SEVERITY_LABEL[s]}</option>)}</select>
          <select name="source" defaultValue={d.source} className="input" aria-label="Herkunft">{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
          <input name="cost" defaultValue={d.costCents ? (d.costCents / 100).toLocaleString("de-DE") : ""} placeholder="Kosten der Beseitigung netto (€)" className="input" aria-label="Kosten" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="warranty" defaultChecked={d.warranty} className="size-4 accent-brand" /> Gewährleistungsfall</label>
          <textarea name="description" rows={3} defaultValue={d.description ?? ""} placeholder="Beschreibung" className="input sm:col-span-2" aria-label="Beschreibung" />
          <button className="btn-primary sm:col-span-2 sm:justify-self-end">Speichern</button>
        </form>
      </details>
    </main>
  );
}
