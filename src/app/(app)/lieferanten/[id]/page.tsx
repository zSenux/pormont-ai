import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, ClipboardList, Globe, Mail, Phone, Search, Sparkles, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime, formatEuro } from "@/lib/berlin";
import { KIND_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, type SupplierKindKey } from "@/lib/suppliers";
import { priceText, searchCatalog } from "@/lib/catalog";
import { clearCatalog, deleteSupplier } from "@/app/actions/lieferanten";
import { stockFromCatalog } from "@/app/actions/lager";
import { ActionButton } from "@/components/confirm-button";
import { CatalogUpload, RequestForm, SupplierForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const q = (await searchParams).q?.trim().slice(0, 80) ?? "";
  const s = await db.supplier.findUnique({
    where: { id: id.data },
    include: { requests: { orderBy: { createdAt: "desc" }, take: 30, include: { project: { select: { name: true } } } }, imports: { orderBy: { createdAt: "desc" }, take: 5 }, _count: { select: { items: true } } },
  });
  if (!s) notFound();
  const [projects, hits, sample] = await Promise.all([
    db.project.findMany({ where: { status: { in: ["PLANUNG", "LAEUFT"] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, name: true } }),
    q ? searchCatalog(q, { supplierId: s.id, take: 60 }) : Promise.resolve([]),
    !q && s._count.items ? db.catalogItem.findMany({ where: { supplierId: s.id }, orderBy: { updatedAt: "desc" }, take: 8 }) : Promise.resolve([]),
  ]);
  const tel = s.phone?.replace(/[^\d+]/g, "");
  const list = q ? hits : sample;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/lieferanten" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Lieferanten</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{s.name}</h1>
          <p className="mt-1 text-sm text-steel">{[s.contactName, s.email, [s.postalCode, s.city].filter(Boolean).join(" "), s.customerNo ? `Kd.-Nr. ${s.customerNo}` : null].filter(Boolean).join(" · ") || "Kontaktdaten unten unter „Daten bearbeiten“ eintragen."}</p>
        </div>
        <span className="chip bg-mist px-3 py-1 text-steel">{KIND_LABEL[s.kind as SupplierKindKey]}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {tel && <a href={`tel:${tel}`} className="btn-secondary"><Phone className="size-4" /> Anrufen</a>}
        {s.email && <a href={`mailto:${s.email}`} className="btn-secondary"><Mail className="size-4" /> E-Mail</a>}
        {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="btn-secondary"><Globe className="size-4" /> Website</a>}
        <a href={`/jarvis?neu=1&q=${encodeURIComponent(`Ich möchte bei ${s.name} eine Preisanfrage stellen. Frag mich kurz nach Material, Mengen und Projekt und bereite sie dann vor.`)}`} className="btn-secondary"><Sparkles className="size-4" /> Mit Jarvis anfragen</a>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-5">
          <section className="card space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-brand" /> Neue Preisanfrage</h2>
            <RequestForm supplierId={s.id} kind={s.kind} projects={projects} hasEmail={Boolean(s.email)} />
            <p className="text-xs text-steel">Jarvis schreibt daraus die Mail. Du siehst sie vor dem Senden und kannst sie ändern.</p>
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Anfragen</h2>
            {s.requests.length === 0 ? (
              <p className="mt-2 text-sm text-steel">Noch keine.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {s.requests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/lieferanten/anfrage/${r.id}`} className="flex items-start gap-2 py-2 text-sm hover:text-brand">
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.subject}</span><span className="block text-xs text-steel">{formatDate(r.sentAt ?? r.createdAt)}{r.project ? ` · ${r.project.name}` : ""}{r.createdBy ? ` · ${r.createdBy}` : ""}</span></span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={clsx("chip px-2 py-0.5 text-[11px]", REQUEST_STATUS_TONE[r.status])}>{REQUEST_STATUS_LABEL[r.status]}</span>
                        {r.offerAmount !== null && <span className="text-xs font-medium">{formatEuro(r.offerAmount)}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-brand" /> Katalog <span className="text-sm font-normal text-steel">{s._count.items.toLocaleString("de-DE")} Artikel</span></h2>
            {s._count.items > 0 && (
              <form className="flex gap-2" action={`/lieferanten/${s.id}`}>
                <input name="q" defaultValue={q} placeholder="Artikel, Abmessung oder Nummer …" className="input min-w-0 flex-1" aria-label="Im Katalog suchen" />
                <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
              </form>
            )}
            {list.length > 0 && (
              <ul className="divide-y divide-line">
                {!q && <li className="pb-1 text-xs text-steel">Zuletzt importiert:</li>}
                {list.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">{h.name}</span>{h.description ? <span className="text-steel"> · {h.description}</span> : null}<span className="block text-xs text-steel">Nr. {h.articleNo}{h.group ? ` · ${h.group}` : ""}</span></span>
                    <span className="shrink-0 font-semibold">{priceText(h)}</span>
                    <ActionButton action={stockFromCatalog.bind(null, h.id)} className="text-xs font-medium text-brand hover:underline" title="Als Lagerartikel übernehmen">Ins Lager</ActionButton>
                  </li>
                ))}
              </ul>
            )}
            {q && hits.length === 0 && <p className="text-sm text-steel">Nichts gefunden.</p>}
            <CatalogUpload supplierId={s.id} />
            {s.imports.length > 0 && (
              <ul className="space-y-1 border-t border-line pt-3 text-xs text-steel">
                {s.imports.map((i) => (
                  <li key={i.id} className={clsx(i.status === "fehler" && "text-bad")}>
                    {formatDateTime(i.createdAt)} · {i.fileName} · {i.status === "laeuft" ? "wird ausgelesen …" : i.status === "fehler" ? i.note : `${i.created} neu, ${i.updated} aktualisiert${i.skipped ? `, ${i.skipped} übersprungen` : ""} · ${i.note ?? ""}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <details className="card p-4" open={!s.email}>
            <summary className="cursor-pointer font-semibold">Daten bearbeiten</summary>
            <div className="mt-3"><SupplierForm s={s} /></div>
          </details>
          {s.notes && <p className="card whitespace-pre-line p-4 text-sm text-steel">{s.notes}</p>}
          <div className="flex flex-wrap gap-2">
            {s._count.items > 0 && <ActionButton action={clearCatalog.bind(null, s.id)} confirm={`Alle ${s._count.items} Katalog-Artikel von ${s.name} löschen?`} className="btn-secondary">Katalog leeren</ActionButton>}
            <ActionButton action={deleteSupplier.bind(null, s.id)} confirm={`${s.name} mit Anfragen und Katalog löschen?`} className="btn-danger"><Trash2 className="size-4" /> Löschen</ActionButton>
          </div>
        </aside>
      </div>
    </main>
  );
}
