import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calculator, ClipboardList, FileText, FolderOpen, Pencil, Sparkles, UserRound } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { STATUS_LABEL as DOC_STATUS } from "@/lib/buchhaltung/docs";
import { calcProject } from "@/lib/nachkalkulation";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, type OrderStatus } from "@/lib/orders-shared";
import { setOrderStatus, updateOrder } from "@/app/actions/auftraege";
import { ActionButton } from "@/components/confirm-button";
import { ProjectProduction } from "@/components/project-production";
import { ProjectAssemblies } from "@/components/project-assemblies";
import { ProjectPlan } from "../../projekte/[id]/plan";

export const dynamic = "force-dynamic";

const ymdOf = (d: Date | null) => (d ? berlinParts(d).ymd : "");
const euroIn = (c: number) => (c ? (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = await db.order.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: o ? `${o.number} ${o.title}` : "Auftrag" };
}

export default async function AuftragDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: true,
      quote: { select: { id: true, number: true, status: true, date: true } },
      project: { include: { files: { where: { kind: { not: "foto" } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true } }, docs: { where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] } }, orderBy: { date: "desc" }, select: { id: true, kind: true, number: true, status: true, grossCents: true, paidCents: true, prepaidCents: true, date: true } } } },
    },
  });
  if (!o) notFound();
  const calc = await calcProject(o.projectId);
  const st = o.status as OrderStatus;
  const late = o.dueDate && o.dueDate < new Date() && st !== "ABGESCHLOSSEN" && st !== "STORNIERT";
  const invoiced = o.project.docs.filter((d) => d.kind === "RECHNUNG" && d.status !== "ENTWURF" && d.status !== "STORNIERT").reduce((s, d) => s + d.grossCents - d.prepaidCents, 0);
  const ask = `/jarvis?q=${encodeURIComponent(`Gib mir einen Stand zum Auftrag ${o.number} „${o.title}“.`)}`;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/auftraege" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Aufträge</Link>

      <header className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand"><ClipboardList className="mr-1 inline size-4" />Auftrag {o.number}</p>
            <h1 className="text-2xl font-bold tracking-tight">{o.title}</h1>
            <p className="text-sm text-steel">{o.customer ? <Link href={`/buchhaltung/kunden/${o.customer.id}`} className="text-brand">{o.customer.name}</Link> : o.project.customer ?? "Kein Kunde"}{o.customerRef && ` · Zeichen: ${o.customerRef}`}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => (
              <ActionButton key={s} action={setOrderStatus.bind(null, o.id, s)} confirm={s === "STORNIERT" ? "Auftrag stornieren?" : undefined} className={clsx("chip px-3 py-1 text-xs", s === st ? ORDER_STATUS_TONE[s] : "bg-white text-steel")}>{ORDER_STATUS_LABEL[s]}</ActionButton>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-xs text-steel">Auftragswert netto</dt><dd className="text-lg font-bold">{fmtEuroCents(o.valueCents)}</dd></div>
          <div><dt className="text-xs text-steel">Beginn</dt><dd className="font-semibold">{o.startDate ? formatDate(o.startDate) : "–"}</dd></div>
          <div><dt className="text-xs text-steel">Fertigstellung</dt><dd className={clsx("font-semibold", late && "text-bad")}>{o.dueDate ? formatDate(o.dueDate) : "offen"}{late && " (überschritten)"}</dd></div>
          <div><dt className="text-xs text-steel">Abgerechnet (brutto)</dt><dd className="font-semibold">{fmtEuroCents(invoiced)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={`/projekte/${o.projectId}`} className="btn-secondary"><FolderOpen className="size-4" /> Projektakte</Link>
          {o.quote && <Link href={`/buchhaltung/beleg/${o.quote.id}`} className="btn-secondary"><FileText className="size-4" /> Angebot {o.quote.number ?? "(Entwurf)"} · {DOC_STATUS[o.quote.status]}</Link>}
          <Link href={`/projekte/${o.projectId}/nachkalkulation`} className="btn-secondary">
            <Calculator className="size-4" /> Nachkalkulation
            <span className={clsx("text-xs font-semibold", calc.marginPct === null ? "text-steel" : calc.marginPct < 0 ? "text-bad" : calc.marginPct < 15 ? "text-warn" : "text-ok")}>{calc.marginPct !== null ? `${calc.marginPct.toLocaleString("de-DE", { maximumFractionDigits: 0 })} % Marge` : ""}</span>
          </Link>
          <Link href={ask} className="btn-secondary"><Sparkles className="size-4" /> Stand von Jarvis</Link>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Pencil className="size-4 text-brand" /> Auftragsdaten</h2>
          <form action={updateOrder.bind(null, o.id)} className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-steel sm:col-span-2">Bezeichnung<input name="title" required defaultValue={o.title} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Auftragswert netto €<input name="value" inputMode="decimal" defaultValue={euroIn(o.valueCents)} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Zeichen/Bestellnr. Kunde<input name="customerRef" defaultValue={o.customerRef ?? ""} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Beginn<input name="start" type="date" defaultValue={ymdOf(o.startDate)} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Fertigstellung<input name="due" type="date" defaultValue={ymdOf(o.dueDate)} className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel sm:col-span-2">Materialbedarf<textarea name="material" rows={3} defaultValue={o.material ?? ""} placeholder="z. B. 8 Stk HEA 200 S355 6 m, 24 m Flachstahl 50×8, Gitterroste 800×270" className="input mt-1 w-full resize-y" /></label>
            <label className="text-xs text-steel sm:col-span-2">Fertigungsinformationen<textarea name="production" rows={3} defaultValue={o.production ?? ""} placeholder="z. B. feuerverzinkt + pulverbeschichtet RAL 7016, EXC2, Schweißnähte nach Plan" className="input mt-1 w-full resize-y" /></label>
            <label className="text-xs text-steel sm:col-span-2">Interne Notizen<textarea name="notes" rows={2} defaultValue={o.notes ?? ""} className="input mt-1 w-full resize-y" /></label>
            <button className="btn-primary sm:col-span-2 sm:justify-self-end">Speichern</button>
          </form>
        </section>
        <div className="space-y-5">
          {o.customer && (
            <section className="card space-y-1 p-5 text-sm">
              <h2 className="mb-2 flex items-center gap-2 font-semibold"><UserRound className="size-4 text-brand" /> Kunde</h2>
              <p className="font-medium">{o.customer.name}{o.customer.number && <span className="text-steel"> · Nr. {o.customer.number}</span>}</p>
              {o.customer.contactName && <p>{o.customer.contactName}</p>}
              {(o.customer.street || o.customer.city) && <p className="text-steel">{[o.customer.street, [o.customer.zip, o.customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>}
              {o.customer.phone && <a href={`tel:${o.customer.phone}`} className="block text-brand">{o.customer.phone}</a>}
              {o.customer.email && <a href={`mailto:${o.customer.email}`} className="block text-brand">{o.customer.email}</a>}
            </section>
          )}
          <section className="card space-y-2 p-5 text-sm">
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-brand" /> Rechnungen & Dokumente</h2>
            <ul className="divide-y divide-line">
              {o.project.docs.length === 0 && o.project.files.length === 0 && <li className="py-1 text-steel">Noch nichts.</li>}
              {o.project.docs.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 py-1.5">
                  <Link href={`/buchhaltung/beleg/${d.id}`} className="truncate text-brand">{d.kind === "GUTSCHRIFT" ? "Gutschrift" : "Rechnung"} {d.number ?? "(Entwurf)"}</Link>
                  <span className="shrink-0 text-steel">{fmtEuroCents(d.grossCents)} · {DOC_STATUS[d.status]}</span>
                </li>
              ))}
              {o.project.files.map((f) => (
                <li key={f.id} className="py-1.5"><a href={`/api/dateien/${f.id}`} className="truncate text-brand">{f.name}</a></li>
              ))}
            </ul>
            <Link href={`/projekte/${o.projectId}`} className="text-xs text-brand">Dokumente hochladen in der Projektakte</Link>
          </section>
        </div>
      </div>

      <ProjectProduction projectId={o.projectId} />
      <ProjectAssemblies projectId={o.projectId} />

      <ProjectPlan projectId={o.projectId} leaderId={o.project.leaderId} />
    </main>
  );
}
