import Link from "next/link";
import { BellRing, ClipboardList, FileText, HardHat, Inbox, MessageSquareText, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { fileUrl } from "@/lib/files";
import { NOTE_KIND_LABEL, type NoteKind } from "@/lib/crm";
import { currentPhase, phaseTitle, progressOf } from "@/lib/phases";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, type OrderStatus } from "@/lib/orders-shared";
import { addCustomerNote, createInquiry, deleteCustomerNote, toggleFollowUp } from "@/app/actions/crm";
import { ActionButton } from "@/components/confirm-button";
import { ProgressBar } from "@/components/progress-bar";

/** Kundenakte (CRM): Aufträge, Anfragen, Kontakthistorie, Wiedervorlagen, Dokumente – unter den Stammdaten der Buchhaltung */
export async function CustomerFile({ customerId }: { customerId: string }) {
  const [notes, orders, projects, users] = await Promise.all([
    db.customerNote.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 100, include: { assignee: { select: { name: true } } } }),
    db.order.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, include: { project: { select: { phases: { select: { key: true, status: true, sort: true } } } } } }),
    db.project.findMany({ where: { customerId }, orderBy: { updatedAt: "desc" }, include: { order: { select: { id: true } }, phases: { select: { key: true, status: true, sort: true } }, files: { where: { kind: { not: "foto" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, createdAt: true } } } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const inquiries = projects.filter((p) => !p.order);
  const files = projects.flatMap((p) => p.files.map((f) => ({ ...f, project: p.name }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20);
  const followUps = notes.filter((n) => n.followUpAt && !n.followUpDone).sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-brand" /> Aufträge</h2>
          {orders.length === 0 ? <p className="text-sm text-steel">Noch keine Aufträge.</p> : (
            <ul className="space-y-2 text-sm">
              {orders.map((o) => {
                const pct = progressOf(o.project.phases);
                return (
                  <li key={o.id}>
                    <Link href={`/auftraege/${o.id}`} className="block space-y-1 rounded-xl p-1 hover:bg-mist">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate"><strong>{o.number}</strong> · {o.title}</span>
                        <span className="font-semibold">{fmtEuroCents(o.valueCents)}</span>
                        <span className={clsx("chip px-2 py-0.5 text-[11px]", ORDER_STATUS_TONE[o.status as OrderStatus])}>{ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}</span>
                      </div>
                      <ProgressBar pct={pct} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold"><Inbox className="size-4 text-brand" /> Anfragen & Projekte ohne Auftrag</h3>
          <ul className="space-y-1 text-sm">
            {inquiries.length === 0 && <li className="text-steel">Keine offenen Anfragen.</li>}
            {inquiries.map((p) => {
              const cur = currentPhase(p.phases);
              return (
                <li key={p.id}><Link href={`/projekte/${p.id}`} className="flex justify-between gap-2 hover:text-brand"><span className="truncate"><HardHat className="mr-1 inline size-3.5 text-steel" />{p.name}</span><span className="shrink-0 text-xs text-steel">{cur ? phaseTitle(cur.key) : "fertig"}</span></Link></li>
              );
            })}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand">Neue Kundenanfrage erfassen</summary>
            <form action={createInquiry.bind(null, customerId)} className="mt-2 grid gap-2">
              <input name="title" required minLength={2} placeholder="z. B. Balkongeländer Neubau, 3 Etagen" className="input" aria-label="Anfrage" />
              <textarea name="description" rows={2} placeholder="Was wünscht der Kunde? Maße, Material, Termin …" className="input resize-y" aria-label="Beschreibung" />
              <button className="btn-secondary justify-self-end">Anfrage anlegen</button>
            </form>
          </details>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="size-4 text-brand" /> Wiedervorlagen</h2>
          <ul className="space-y-1 text-sm">
            {followUps.length === 0 && <li className="text-steel">Keine offenen Wiedervorlagen.</li>}
            {followUps.map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <ActionButton action={toggleFollowUp.bind(null, n.id)} className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 border-line hover:border-brand" title="Erledigt"><span /></ActionButton>
                <span className="min-w-0 flex-1">
                  <span className="block">{n.text}</span>
                  <span className={clsx("text-xs", n.followUpAt! <= now ? "font-semibold text-bad" : "text-steel")}>{formatDate(n.followUpAt)}{n.assignee && ` · ${n.assignee.name}`}</span>
                </span>
              </li>
            ))}
          </ul>
          <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold"><FileText className="size-4 text-brand" /> Dokumente aus den Projekten</h3>
          <ul className="space-y-1 text-sm">
            {files.length === 0 && <li className="text-steel">Noch keine Dokumente.</li>}
            {files.map((f) => (
              <li key={f.id} className="flex justify-between gap-2"><a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="truncate text-brand">{f.name}</a><span className="shrink-0 text-xs text-steel">{f.project}</span></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><MessageSquareText className="size-4 text-brand" /> Kontakthistorie & interne Notizen</h2>
        <form action={addCustomerNote.bind(null, customerId)} className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <select name="kind" className="input" aria-label="Art" defaultValue="NOTIZ">
            {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => <option key={k} value={k}>{NOTE_KIND_LABEL[k]}</option>)}
          </select>
          <textarea name="text" required rows={2} placeholder="z. B. Herr Müller angerufen, will Angebot bis Freitag" className="input resize-y" aria-label="Notiz" />
          <label className="text-xs text-steel sm:col-start-2 sm:flex sm:items-center sm:gap-2">
            Wiedervorlage am <input name="followUp" type="date" className="input mt-1 sm:mt-0" />
            <select name="assigneeId" className="input mt-1 sm:mt-0" aria-label="Zuständig" defaultValue="">
              <option value="">zuständig: niemand</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn-primary mt-2 sm:ml-auto sm:mt-0">Speichern</button>
          </label>
        </form>
        <ul className="divide-y divide-line text-sm">
          {notes.length === 0 && <li className="py-2 text-steel">Noch keine Einträge.</li>}
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2">
              <span className="chip shrink-0 bg-mist px-2 py-0.5 text-[11px] text-steel">{NOTE_KIND_LABEL[n.kind as NoteKind] ?? n.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block whitespace-pre-line">{n.text}</span>
                <span className="text-xs text-steel">{formatDateTime(n.createdAt)}{n.authorName && ` · ${n.authorName}`}{n.followUpAt && ` · Wiedervorlage ${formatDate(n.followUpAt)}${n.followUpDone ? " ✓" : ""}`}</span>
              </span>
              <ActionButton action={deleteCustomerNote.bind(null, n.id)} confirm="Eintrag löschen?" className="text-steel/60 hover:text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
