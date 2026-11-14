import Link from "next/link";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { currentPhase, phaseTitle, progressOf } from "@/lib/phases";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, type OrderStatus } from "@/lib/orders-shared";
import { newOrder, orderFromQuote } from "@/app/actions/auftraege";
import { ActionButton } from "@/components/confirm-button";
import { ProgressBar } from "@/components/progress-bar";

export const metadata = { title: "Aufträge" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "aktiv", label: "Aktiv" },
  { key: "abgeschlossen", label: "Abgeschlossen" },
  { key: "alle", label: "Alle" },
];

export default async function AuftraegePage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const filter = sp.filter ?? "aktiv";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const where = {
    ...(filter === "abgeschlossen" ? { status: { in: ["ABGESCHLOSSEN", "STORNIERT"] } } : filter === "alle" ? {} : { status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } }),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { title: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [orders, openQuotes, customers, users] = await Promise.all([
    db.order.findMany({ where, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 200, include: { customer: { select: { name: true } }, project: { select: { leader: { select: { name: true } }, phases: { select: { key: true, status: true, sort: true } } } } } }),
    db.salesDoc.findMany({ where: { kind: "ANGEBOT", status: "ANGENOMMEN", orders: { none: {} } }, orderBy: { date: "desc" }, take: 20, include: { customer: { select: { name: true } } } }),
    db.customer.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, number: true }, take: 1000 }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const total = orders.reduce((s, o) => s + o.valueCents, 0);
  const now = new Date();

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Aufträge</h1>
        <p className="mt-1 text-sm text-steel">Jeder Auftrag hat eine Projektakte mit Phasen, Team, Stunden, Dokumenten und Nachkalkulation. Wird ein Angebot angenommen, entsteht der Auftrag automatisch.</p>
      </div>

      {openQuotes.length > 0 && (
        <section className="card space-y-2 border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-warn">Angenommene Angebote ohne Auftrag</h2>
          <ul className="divide-y divide-amber-200 text-sm">
            {openQuotes.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Link href={`/buchhaltung/beleg/${d.id}`} className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{d.number}</span> · {d.customer?.name ?? "–"}{d.title && ` · ${d.title}`}
                </Link>
                <span className="shrink-0 text-steel">{fmtEuroCents(d.netCents)}</span>
                <ActionButton action={orderFromQuote.bind(null, d.id)} className="btn-secondary shrink-0">Auftrag anlegen</ActionButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="card p-4">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><FilePlus2 className="size-4 text-brand" /> Auftrag ohne Angebot anlegen</summary>
        <form action={newOrder} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="title" required minLength={2} placeholder="Bezeichnung, z. B. „Reparatur Rolltor Halle 2“" className="input sm:col-span-2" aria-label="Bezeichnung" />
          <select name="customerId" className="input" aria-label="Kunde" defaultValue="">
            <option value="">Kunde (optional)</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.number ? ` (${c.number})` : ""}</option>)}
          </select>
          <input name="value" inputMode="decimal" placeholder="Auftragswert netto €" className="input" aria-label="Auftragswert netto" />
          <label className="text-xs text-steel">Beginn<input name="start" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Fertigstellung<input name="due" type="date" className="input mt-1 w-full" /></label>
          <input name="address" placeholder="Baustelle / Lieferadresse" className="input" aria-label="Adresse" />
          <select name="leaderId" className="input" aria-label="Projektleiter" defaultValue="">
            <option value="">Projektleiter: ich</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input name="customerRef" placeholder="Bestellnummer/Zeichen des Kunden" className="input sm:col-span-2" aria-label="Zeichen des Kunden" />
          <button className="btn-primary sm:col-span-2 sm:justify-self-end">Auftrag anlegen</button>
        </form>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/auftraege?filter=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={clsx("chip px-3 py-1", filter === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{f.label}</Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q} placeholder="Suche: Nummer, Kunde, Titel" className="input w-56" aria-label="Suche" />
        </form>
      </div>
      <p className="text-sm text-steel">{orders.length} Aufträge · Auftragsvolumen netto <strong className="text-ink">{fmtEuroCents(total)}</strong></p>

      <ul className="space-y-3">
        {orders.length === 0 && <li className="card p-5 text-sm text-steel">Keine Aufträge.</li>}
        {orders.map((o) => {
          const st = o.status as OrderStatus;
          const pct = progressOf(o.project.phases);
          const cur = currentPhase(o.project.phases);
          const late = o.dueDate && o.dueDate < now && st !== "ABGESCHLOSSEN" && st !== "STORNIERT";
          return (
            <li key={o.id}>
              <Link href={`/auftraege/${o.id}`} className="card block space-y-2 p-4 transition hover:border-brand">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-brand"><ClipboardList className="mr-1 inline size-3.5" />{o.number}</p>
                    <h2 className="font-semibold leading-snug">{o.title}</h2>
                    <p className="text-sm text-steel">{[o.customer?.name, o.project.leader && `PL ${o.project.leader.name}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="text-right">
                    <span className={clsx("chip px-2 py-0.5 text-[11px]", ORDER_STATUS_TONE[st])}>{ORDER_STATUS_LABEL[st] ?? st}</span>
                    <p className="mt-1 font-semibold">{fmtEuroCents(o.valueCents)}</p>
                  </div>
                </div>
                <ProgressBar pct={pct} />
                <p className={clsx("text-xs", late ? "text-bad" : "text-steel")}>
                  {pct} % · {cur ? phaseTitle(cur.key) : "alle Phasen erledigt"}{o.dueDate && ` · ${late ? "Termin überschritten: " : "fertig bis "}${formatDate(o.dueDate)}`}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
