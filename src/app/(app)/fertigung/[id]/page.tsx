import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Pencil, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, formatDateTime } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { MACHINES, PROD_LABEL, PROD_STATUS, PROD_TONE, type ProdStatus } from "@/lib/production-shared";
import { PRIORITY_LABEL, type Priority } from "@/lib/phases-shared";
import { deleteJob, moveJob, reportJob, updateJob } from "@/app/actions/fertigung";
import { ActionButton } from "@/components/confirm-button";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

const ymdOf = (d: Date | null) => (d ? berlinParts(d).ymd : "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const j = await db.productionJob.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: j ? `${j.number} ${j.title}` : "Fertigungsauftrag" };
}

export default async function Fertigungskarte({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const j = await db.productionJob.findUnique({
    where: { id },
    include: {
      assignee: { select: { name: true } },
      project: { include: { order: { select: { id: true, number: true, material: true, production: true, dueDate: true } }, files: { where: { kind: { not: "foto" } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, name: true } } } },
    },
  });
  if (!j) notFound();
  const users = await db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const st = j.status as ProdStatus;
  const late = j.plannedEnd && j.plannedEnd < new Date() && !["FERTIG", "MONTAGEBEREIT"].includes(st);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/fertigung" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Fertigung</Link>
        <PrintButton label="Karte drucken" />
      </div>

      <article className="card space-y-4 p-5 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand">Fertigungskarte {j.number}</p>
            <h1 className="text-2xl font-bold tracking-tight">{j.title}{j.quantity && <span className="font-normal text-steel"> · {j.quantity}</span>}</h1>
            <p className="text-sm text-steel">
              <Link href={`/projekte/${j.projectId}`} className="text-brand">{j.project.name}</Link>
              {j.project.order && <> · Auftrag <Link href={`/auftraege/${j.project.order.id}`} className="text-brand">{j.project.order.number}</Link></>}
              {j.project.customer && ` · ${j.project.customer}`}
            </p>
          </div>
          <span className={clsx("chip px-3 py-1 text-sm", PROD_TONE[st])}>{PROD_LABEL[st] ?? st}</span>
        </header>

        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-xs text-steel">Mitarbeiter</dt><dd className="font-semibold">{j.assignee?.name ?? "–"}</dd></div>
          <div><dt className="text-xs text-steel">Maschine / Platz</dt><dd className="font-semibold">{j.machine ?? "–"}</dd></div>
          <div><dt className="text-xs text-steel">Zeitraum</dt><dd className={clsx("font-semibold", late && "text-bad")}>{j.plannedStart ? formatDate(j.plannedStart) : "?"} – {j.plannedEnd ? formatDate(j.plannedEnd) : "?"}</dd></div>
          <div><dt className="text-xs text-steel">Stunden Plan / Ist</dt><dd className="font-semibold">{j.plannedHours?.toLocaleString("de-DE") ?? "–"} / {j.actualHours?.toLocaleString("de-DE") ?? "–"}</dd></div>
          <div><dt className="text-xs text-steel">Priorität</dt><dd className="font-semibold">{PRIORITY_LABEL[j.priority as Priority] ?? j.priority}</dd></div>
          <div><dt className="text-xs text-steel">Material</dt><dd className={clsx("font-semibold", j.materialOk ? "text-ok" : "text-warn")}>{j.materialOk ? "bereit" : "nicht bestätigt"}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-steel">Auftrag fertig bis</dt><dd className="font-semibold">{j.project.order?.dueDate ? formatDate(j.project.order.dueDate) : "–"}</dd></div>
        </dl>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Arbeitsanweisung</h2>
          <p className="whitespace-pre-line rounded-xl bg-mist/60 p-3 text-sm">{j.instructions || "Keine Arbeitsanweisung hinterlegt."}</p>
        </section>
        {(j.project.order?.production || j.project.order?.material || j.materialNote) && (
          <section className="grid gap-3 md:grid-cols-2">
            {j.project.order?.production && <div><h2 className="mb-1 text-sm font-semibold">Fertigungsinformationen (Auftrag)</h2><p className="whitespace-pre-line text-sm">{j.project.order.production}</p></div>}
            {(j.project.order?.material || j.materialNote) && <div><h2 className="mb-1 text-sm font-semibold">Material</h2><p className="whitespace-pre-line text-sm">{[j.project.order?.material, j.materialNote].filter(Boolean).join("\n")}</p></div>}
          </section>
        )}
        <section>
          <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold"><FileText className="size-4 text-brand" /> Zeichnungen & Dokumente</h2>
          <ul className="text-sm">
            {j.project.files.length === 0 && <li className="text-steel">Keine Dokumente in der Projektakte.</li>}
            {j.project.files.map((f) => <li key={f.id}><a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="text-brand">{f.name}</a></li>)}
          </ul>
        </section>
        {(j.qcAt || j.qcNote || j.doneAt) && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="size-4" /> Qualitätskontrolle & Fertigmeldung</p>
            {j.qcNote && <p className="mt-1 whitespace-pre-line">{j.qcNote}</p>}
            <p className="mt-1 text-xs text-steel">{[j.qcAt && `geprüft ${formatDateTime(j.qcAt)}${j.qcBy ? ` (${j.qcBy})` : ""}`, j.doneAt && `fertig gemeldet ${formatDateTime(j.doneAt)}${j.doneBy ? ` (${j.doneBy})` : ""}`].filter(Boolean).join(" · ")}</p>
          </section>
        )}
        <div className="hidden grid-cols-2 gap-8 pt-10 text-xs text-steel print:grid">
          <p className="border-t border-ink pt-1">Gefertigt (Datum, Name)</p>
          <p className="border-t border-ink pt-1">Geprüft (Datum, Name)</p>
        </div>
      </article>

      <section className="card space-y-3 p-5 print:hidden">
        <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-brand" /> Status & Rückmeldung</h2>
        <div className="flex flex-wrap gap-1.5">
          {PROD_STATUS.map((s) => (
            <ActionButton key={s.key} action={moveJob.bind(null, j.id, s.key)} className={clsx("chip px-3 py-1 text-xs", s.key === st ? PROD_TONE[s.key] : "bg-white text-steel")}>{s.label}</ActionButton>
          ))}
        </div>
        <form action={reportJob.bind(null, j.id)} className="grid gap-2 sm:grid-cols-3">
          <select name="status" defaultValue={st === "QK" ? "FERTIG" : st === "IN_FERTIGUNG" ? "QK" : st} className="input" aria-label="Neuer Status">
            {PROD_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input name="actualHours" inputMode="decimal" defaultValue={j.actualHours ?? ""} placeholder="Ist-Stunden" className="input" aria-label="Ist-Stunden" />
          <input name="materialNote" defaultValue={j.materialNote ?? ""} placeholder="Material: was fehlt / Lagerort" className="input" aria-label="Material" />
          <textarea name="qcNote" rows={2} defaultValue={j.qcNote ?? ""} placeholder="Qualitätskontrolle: Maße geprüft, Schweißnähte i. O., Mängel …" className="input resize-y sm:col-span-3" aria-label="Qualitätskontrolle" />
          <button className="btn-primary sm:col-span-3 sm:justify-self-end">Rückmelden</button>
        </form>
      </section>

      <details className="card p-5 print:hidden">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Pencil className="size-4 text-brand" /> Karte bearbeiten</summary>
        <form action={updateJob.bind(null, j.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="title" required defaultValue={j.title} className="input sm:col-span-2" aria-label="Bezeichnung" />
          <input name="quantity" defaultValue={j.quantity ?? ""} placeholder="Menge" className="input" aria-label="Menge" />
          <input name="machine" list="maschinen" defaultValue={j.machine ?? ""} placeholder="Maschine" className="input" aria-label="Maschine" />
          <datalist id="maschinen">{MACHINES.map((m) => <option key={m} value={m} />)}</datalist>
          <select name="assigneeId" defaultValue={j.assigneeId ?? ""} className="input" aria-label="Mitarbeiter">
            <option value="">Mitarbeiter</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input name="plannedHours" inputMode="decimal" defaultValue={j.plannedHours ?? ""} placeholder="Plan-Stunden" className="input" aria-label="Plan-Stunden" />
          <label className="text-xs text-steel">Beginn<input name="start" type="date" defaultValue={ymdOf(j.plannedStart)} className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Fertig bis<input name="end" type="date" defaultValue={ymdOf(j.plannedEnd)} className="input mt-1 w-full" /></label>
          <select name="priority" defaultValue={j.priority} className="input" aria-label="Priorität">{(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          <textarea name="instructions" rows={4} defaultValue={j.instructions ?? ""} placeholder="Arbeitsanweisung" className="input resize-y sm:col-span-2" aria-label="Arbeitsanweisung" />
          <div className="flex justify-between sm:col-span-2">
            <ActionButton action={deleteJob.bind(null, j.id)} confirm="Fertigungsauftrag löschen?" className="btn-secondary text-bad"><Trash2 className="size-4" /> Löschen</ActionButton>
            <button className="btn-primary">Speichern</button>
          </div>
        </form>
      </details>
    </main>
  );
}
