import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Eye, Send, Trash2, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDateTime } from "@/lib/berlin";
import { fileUrl, IMAGE_TYPES } from "@/lib/files";
import { canRelease, DRAWING_KIND_LABEL, DRAWING_STATUS_LABEL, DRAWING_TONE, indexLetter, type DrawingKind, type DrawingStatus } from "@/lib/drawings-shared";
import { deleteDrawing, drawingStatus } from "@/app/actions/zeichnungen";
import { ActionButton } from "@/components/confirm-button";
import { DrawingUpload } from "@/components/drawing-upload";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await db.drawing.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: d ? `${d.number} ${d.title}` : "Zeichnung" };
}

export default async function Zeichnung({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const d = await db.drawing.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, customer: true } },
      versions: { orderBy: { version: "desc" }, include: { file: { select: { id: true, name: true, mime: true, size: true } } } },
    },
  });
  if (!d) notFound();
  const st = d.status as DrawingStatus;
  const current = d.versions[0];
  const released = d.releasedVersion ? d.versions.find((v) => v.version === d.releasedVersion) : null;
  const preview = current && (current.file.mime === "application/pdf" || IMAGE_TYPES.includes(current.file.mime));
  const may = canRelease(me);

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:py-10">
      <Link href="/zeichnungen" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Zeichnungen</Link>

      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand">{d.number} · {DRAWING_KIND_LABEL[d.kind as DrawingKind] ?? d.kind}</p>
            <h1 className="text-2xl font-bold tracking-tight">{d.title}</h1>
            <p className="text-sm text-steel"><Link href={`/projekte/${d.project.id}`} className="text-brand">{d.project.name}</Link>{d.project.customer && ` · ${d.project.customer}`}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold tracking-tight">Index {indexLetter(d.currentVersion)}</p>
            <span className={clsx("chip px-3 py-1 text-xs", DRAWING_TONE[st])}>{DRAWING_STATUS_LABEL[st] ?? st}</span>
          </div>
        </div>
        {released && st !== "FREIGEGEBEN" && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-warn">Für Werkstatt und Montage gilt weiter <strong>Index {indexLetter(released.version)}</strong> (freigegeben {d.releasedAt && formatDateTime(d.releasedAt)} von {d.releasedBy}). <a href={fileUrl(released.file.id)} target="_blank" rel="noreferrer" className="underline">Öffnen</a></p>
        )}
        {!released && st !== "UNGUELTIG" && <p className="rounded-xl bg-mist p-3 text-sm text-steel">Noch kein Index freigegeben – nicht nach dieser Zeichnung fertigen.</p>}
        {st === "FREIGEGEBEN" && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-ok">Freigegeben am {d.releasedAt && formatDateTime(d.releasedAt)} von {d.releasedBy} – gilt für Werkstatt und Montage.</p>}
        <div className="flex flex-wrap gap-2">
          {current && <a href={fileUrl(current.file.id)} target="_blank" rel="noreferrer" className="btn-secondary"><Eye className="size-4" /> Index {indexLetter(current.version)} öffnen</a>}
          {st === "ENTWURF" && <ActionButton action={drawingStatus.bind(null, d.id, "PRUEFUNG")} className="btn-secondary"><Send className="size-4" /> Zur Prüfung geben</ActionButton>}
          {may && (st === "ENTWURF" || st === "PRUEFUNG") && <ActionButton action={drawingStatus.bind(null, d.id, "FREIGEGEBEN")} confirm={`Index ${indexLetter(d.currentVersion)} für Werkstatt und Montage freigeben?`} className="btn-primary"><CheckCircle2 className="size-4" /> Index {indexLetter(d.currentVersion)} freigeben</ActionButton>}
          {st !== "UNGUELTIG" && <ActionButton action={drawingStatus.bind(null, d.id, "UNGUELTIG")} confirm="Zeichnung als ungültig markieren? Sie wird dann nicht mehr verwendet." className="btn-secondary text-steel"><XCircle className="size-4" /> Ungültig</ActionButton>}
          {st === "UNGUELTIG" && <ActionButton action={drawingStatus.bind(null, d.id, "ENTWURF")} className="btn-secondary">Wieder aktivieren</ActionButton>}
          {!d.releasedVersion && <ActionButton action={deleteDrawing.bind(null, d.id)} confirm="Zeichnung samt allen Indizes löschen?" className="btn-secondary text-bad"><Trash2 className="size-4" /> Löschen</ActionButton>}
        </div>
      </header>

      {preview && (
        <section className="card overflow-hidden">
          {current.file.mime === "application/pdf" ? (
            <iframe src={fileUrl(current.file.id)} title={`Vorschau ${d.title}`} className="h-[70vh] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(current.file.id)} alt={d.title} className="w-full" />
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Indexstände</h2>
          <ol className="space-y-2 text-sm">
            {d.versions.map((v) => (
              <li key={v.id} className="flex items-start gap-3">
                <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full font-bold", v.version === d.releasedVersion ? "bg-emerald-100 text-ok" : v.version === d.currentVersion ? "bg-brand-soft text-brand" : "bg-mist text-steel")}>{indexLetter(v.version)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{v.note || "–"}{v.version === d.releasedVersion && <span className="ml-1 text-xs font-semibold text-ok">freigegeben</span>}{v.version < (d.releasedVersion ?? 0) && <span className="ml-1 text-xs text-steel">überholt</span>}</span>
                  <span className="block text-xs text-steel">{formatDateTime(v.createdAt)}{v.uploadedBy && ` · ${v.uploadedBy}`} · {v.file.name} ({Math.max(1, Math.round(v.file.size / 1024))} KB)</span>
                </span>
                <a href={fileUrl(v.file.id, true)} className="text-steel hover:text-brand" title="Herunterladen" aria-label={`Index ${indexLetter(v.version)} herunterladen`}><Download className="size-4" /></a>
              </li>
            ))}
          </ol>
        </section>
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Neuer Index {indexLetter(d.currentVersion + 1)}</h2>
          <p className="text-sm text-steel">Geänderte Zeichnung hochladen (PDF, Bild oder CAD: DXF, DWG, STEP, IFC). Der Status geht zurück auf „In Bearbeitung“; bis zur Freigabe gilt der alte Index weiter.</p>
          <DrawingUpload drawingId={d.id} nextIndex={indexLetter(d.currentVersion + 1)} />
        </section>
      </div>
    </main>
  );
}
