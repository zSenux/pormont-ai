import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, FileSignature, ListChecks, MapPin, NotebookPen, Pencil, Play, Trash2, Truck, Users, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { timeHm } from "@/lib/calendar";
import { fileUrl } from "@/lib/files";
import { ASM_STATUS_LABEL, ASM_TONE, readChecklist, readDefects, type AsmStatus } from "@/lib/assembly-shared";
import { addCheckItem, assemblyStatus, checkItem, deleteAssembly, editAssembly, newDefect, saveReport, toggleDefect } from "@/app/actions/montage";
import { ActionButton } from "@/components/confirm-button";
import { AssemblyFields } from "@/components/assembly-form";
import { Uploader } from "@/components/upload";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await db.assembly.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: a ? `${a.number} ${a.title}` : "Montage" };
}

export default async function MontageDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const a = await db.assembly.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, customer: true, order: { select: { id: true, number: true } } } },
      leader: { select: { name: true } },
      crew: { include: { user: { select: { name: true } } } },
      files: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, mime: true, meta: true, createdAt: true } },
    },
  });
  if (!a) notFound();
  const [users, vehicles] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.assembly.findMany({ where: { vehicle: { not: null } }, distinct: ["vehicle"], select: { vehicle: true }, take: 20 }),
  ]);
  const st = a.status as AsmStatus;
  const checklist = readChecklist(a.checklist);
  const defects = readDefects(a.defects);
  const photo = (phase: string) => a.files.filter((f) => ((f.meta as { phase?: string } | null)?.phase ?? "nachher") === phase && f.mime.startsWith("image/"));
  const open = st === "GEPLANT" || st === "LAEUFT";

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10">
      <Link href="/montage" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Montage</Link>

      <header className="card space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand">{a.number} · {formatDate(a.startAt)} {timeHm(a.startAt)}{a.endAt && ` – ${formatDate(a.endAt) === formatDate(a.startAt) ? timeHm(a.endAt) : formatDate(a.endAt)}`}</p>
            <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
            <p className="text-sm text-steel">
              <Link href={`/projekte/${a.project.id}`} className="text-brand">{a.project.name}</Link>
              {a.project.order && <> · <Link href={`/auftraege/${a.project.order.id}`} className="text-brand">{a.project.order.number}</Link></>}
              {a.project.customer && ` · ${a.project.customer}`}
            </p>
          </div>
          <span className={clsx("chip shrink-0 px-3 py-1 text-xs", ASM_TONE[st])}>{ASM_STATUS_LABEL[st] ?? st}</span>
        </div>
        <div className="space-y-1 text-sm">
          {a.address && <a href={`https://maps.google.com/?q=${encodeURIComponent(a.address)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand"><MapPin className="size-4" /> {a.address}</a>}
          <p className="flex items-center gap-1.5"><Users className="size-4 text-steel" /> {[a.leader && `${a.leader.name} (Leitung)`, ...a.crew.map((c) => c.user.name).filter((n) => n !== a.leader?.name)].filter(Boolean).join(", ") || "Noch kein Team"}</p>
          {a.vehicle && <p className="flex items-center gap-1.5"><Truck className="size-4 text-steel" /> {a.vehicle}</p>}
        </div>
        {a.plan && <p className="whitespace-pre-line rounded-xl bg-mist/60 p-3 text-sm">{a.plan}</p>}
        <div className="flex flex-wrap gap-2">
          {st === "GEPLANT" && <ActionButton action={assemblyStatus.bind(null, a.id, "LAEUFT")} className="btn-primary"><Play className="size-4" /> Montage starten</ActionButton>}
          {open && <ActionButton action={assemblyStatus.bind(null, a.id, "ERLEDIGT")} confirm="Montage als fertig melden? Danach ist das Abnahmeprotokoll bereit." className="btn-primary"><CheckCircle2 className="size-4" /> Montage fertig</ActionButton>}
          <Link href={`/montage/${a.id}/protokoll`} className="btn-secondary"><FileSignature className="size-4" /> Abnahmeprotokoll{a.signedAt ? " (unterschrieben)" : ""}</Link>
          {st === "ERLEDIGT" && <ActionButton action={assemblyStatus.bind(null, a.id, "LAEUFT")} className="btn-secondary">Wieder öffnen</ActionButton>}
          {open && <ActionButton action={assemblyStatus.bind(null, a.id, "ABGESAGT")} confirm="Montage absagen? Der Kalendereintrag wird entfernt." className="btn-secondary text-steel"><XCircle className="size-4" /> Absagen</ActionButton>}
        </div>
      </header>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><ListChecks className="size-4 text-brand" /> Checkliste <span className="ml-auto text-sm font-normal text-steel">{checklist.filter((c) => c.done).length}/{checklist.length}</span></h2>
        <ul className="space-y-1">
          {checklist.map((c, i) => (
            <li key={i}>
              <ActionButton action={checkItem.bind(null, a.id, i)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left text-sm hover:bg-mist">
                <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2", c.done ? "border-ok bg-ok text-white" : "border-line")}>{c.done && <CheckCircle2 className="size-3.5" />}</span>
                <span className="min-w-0 flex-1">
                  <span className={clsx(c.done && "text-steel line-through")}>{c.text}</span>
                  {c.done && c.by && <span className="block text-xs text-steel">{c.by}{c.at && `, ${formatDateTime(c.at)}`}</span>}
                </span>
              </ActionButton>
            </li>
          ))}
        </ul>
        <form action={addCheckItem.bind(null, a.id)} className="flex gap-2">
          <input name="text" required minLength={2} placeholder="Weiterer Punkt" className="input min-w-0 flex-1" aria-label="Checklisten-Punkt" />
          <button className="btn-secondary">Hinzufügen</button>
        </form>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Camera className="size-4 text-brand" /> Fotos</h2>
        {(["vorher", "nachher"] as const).map((ph) => (
          <div key={ph} className="space-y-2">
            <h3 className="text-sm font-semibold">{ph === "vorher" ? "Vorher" : "Nachher"}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photo(ph).map((f) => (
                <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f.id)} alt={f.name} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                </a>
              ))}
            </div>
            <Uploader kind="foto" assemblyId={a.id} phase={ph} camera label={`Foto ${ph}`} />
          </div>
        ))}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><NotebookPen className="size-4 text-brand" /> Montagebericht</h2>
        <form action={saveReport.bind(null, a.id)} className="space-y-2">
          <textarea name="report" rows={5} defaultValue={a.report ?? ""} placeholder="Was wurde montiert? Besonderheiten, Mehraufwand, verbrauchtes Material, Arbeitszeiten …" className="input w-full resize-y" aria-label="Montagebericht" />
          <button className="btn-secondary">Bericht speichern</button>
        </form>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warn" /> Mängel</h2>
        <ul className="space-y-1 text-sm">
          {defects.length === 0 && <li className="text-steel">Keine Mängel festgehalten.</li>}
          {defects.map((d, i) => (
            <li key={i}>
              <ActionButton action={toggleDefect.bind(null, a.id, i)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-mist">
                <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2", d.fixed ? "border-ok bg-ok text-white" : "border-amber-300")}>{d.fixed && <CheckCircle2 className="size-3.5" />}</span>
                <span className="min-w-0 flex-1"><span className={clsx(d.fixed && "text-steel line-through")}>{d.text}</span><span className="block text-xs text-steel">{d.fixed ? "behoben" : "offen"}{d.by && ` · ${d.by}`}{d.at && `, ${formatDateTime(d.at)}`}</span></span>
              </ActionButton>
            </li>
          ))}
        </ul>
        <form action={newDefect.bind(null, a.id)} className="flex gap-2">
          <input name="text" required minLength={2} placeholder="z. B. Kratzer Handlauf oben, nachbessern" className="input min-w-0 flex-1" aria-label="Mangel" />
          <button className="btn-secondary">Festhalten</button>
        </form>
      </section>

      {a.signedAt && (
        <section className="card flex items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-sm">
          <ClipboardCheck className="size-5 text-ok" />
          <span>Abgenommen von <strong>{a.signerName}</strong> am {formatDateTime(a.signedAt)}.</span>
        </section>
      )}

      <details className="card p-5">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Pencil className="size-4 text-brand" /> Termin & Team bearbeiten</summary>
        <form action={editAssembly.bind(null, a.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
          <AssemblyFields a={a} users={users} vehicles={vehicles.map((v) => v.vehicle!).filter(Boolean)} />
          <div className="flex justify-between sm:col-span-2">
            <ActionButton action={deleteAssembly.bind(null, a.id)} confirm="Montage löschen?" className="btn-secondary text-bad"><Trash2 className="size-4" /> Löschen</ActionButton>
            <button className="btn-primary">Speichern</button>
          </div>
        </form>
      </details>
    </main>
  );
}
