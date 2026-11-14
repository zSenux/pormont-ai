import Link from "next/link";
import { FilePlus2, Search } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, formatDate, todayYmd } from "@/lib/berlin";
import { customerName, isOverdue, statusText } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { newDocAction } from "@/app/actions/buchhaltung";
import { TONE } from "@/lib/buchhaltung/ui";

export const metadata = { title: "Belege" };
export const dynamic = "force-dynamic";

const ARTEN = {
  rechnungen: { kind: "RECHNUNG" as const, label: "Rechnungen", status: [["alle", "Alle"], ["offen", "Offen"], ["ueberfaellig", "Überfällig"], ["bezahlt", "Bezahlt"], ["entwurf", "Entwürfe"], ["storniert", "Storniert"]] },
  angebote: { kind: "ANGEBOT" as const, label: "Angebote", status: [["alle", "Alle"], ["offen", "Offen"], ["angenommen", "Angenommen"], ["abgelehnt", "Abgelehnt"], ["abgelaufen", "Abgelaufen"], ["entwurf", "Entwürfe"]] },
  gutschriften: { kind: "GUTSCHRIFT" as const, label: "Gutschriften", status: [["alle", "Alle"]] },
};
type Art = keyof typeof ARTEN;

export default async function BelegeListe({ searchParams }: { searchParams: Promise<{ art?: string; status?: string; q?: string; seite?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const art: Art = sp.art && sp.art in ARTEN ? (sp.art as Art) : "rechnungen";
  const conf = ARTEN[art];
  const status = conf.status.find(([k]) => k === sp.status)?.[0] ?? "alle";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(0, Number(sp.seite ?? 0) || 0);
  const today = berlinDateTime(todayYmd());

  const where: Prisma.SalesDocWhereInput = { kind: conf.kind };
  if (status === "offen") where.status = "OFFEN";
  if (status === "ueberfaellig") Object.assign(where, { status: "OFFEN", dueDate: { lt: today } });
  if (status === "bezahlt") where.status = "BEZAHLT";
  if (status === "entwurf") where.status = "ENTWURF";
  if (status === "storniert") where.status = "STORNIERT";
  if (status === "angenommen") where.status = "ANGENOMMEN";
  if (status === "abgelehnt") where.status = "ABGELEHNT";
  if (status === "abgelaufen") Object.assign(where, { status: "OFFEN", dueDate: { lt: today } });
  if (q) where.OR = [{ number: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }];

  const [docs, count, sum] = await Promise.all([
    db.salesDoc.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: page * 50, take: 50, include: { customer: { select: { name: true } }, project: { select: { name: true } } } }),
    db.salesDoc.count({ where }),
    db.salesDoc.aggregate({ where, _sum: { grossCents: true, paidCents: true } }),
  ]);
  const href = (o: { status?: string; seite?: number }) => `/buchhaltung/belege?art=${art}&status=${o.status ?? status}${q ? `&q=${encodeURIComponent(q)}` : ""}${o.seite ? `&seite=${o.seite}` : ""}`;

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">{conf.label}</h1>
        {conf.kind !== "GUTSCHRIFT" && (
          <form action={newDocAction.bind(null, conf.kind, {})}>
            <button className="btn-primary"><FilePlus2 className="size-4" /> {conf.kind === "ANGEBOT" ? "Neues Angebot" : "Neue Rechnung"}</button>
          </form>
        )}
      </div>
      {conf.kind === "GUTSCHRIFT" && <p className="text-sm text-steel">Gutschriften entstehen beim Stornieren einer Rechnung (Rechnung öffnen → „Stornieren“).</p>}
      <div className="flex flex-wrap gap-2">
        {conf.status.map(([k, l]) => (
          <Link key={k} href={href({ status: k })} className={clsx("chip px-3 py-1", k === status ? "border-brand bg-brand text-white" : "border-line bg-white text-steel hover:text-ink")}>{l}</Link>
        ))}
      </div>
      <form className="flex gap-2" action="/buchhaltung/belege">
        <input type="hidden" name="art" value={art} />
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} placeholder="Nummer, Kunde oder Betreff …" className="input min-w-0 flex-1" aria-label="Suchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>
      <section className="card divide-y divide-line">
        {docs.length === 0 && <p className="p-5 text-sm text-steel">Keine Belege. Sag einfach zu Jarvis: „Mach ein Angebot für …“</p>}
        {docs.map((d) => {
          const overdue = isOverdue(d);
          const expired = d.kind === "ANGEBOT" && d.status === "OFFEN" && d.dueDate && d.dueDate < today;
          return (
            <Link key={d.id} href={`/buchhaltung/beleg/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm hover:bg-mist/60 sm:flex-nowrap">
              <span className="w-32 shrink-0 font-semibold">{d.number ?? "Entwurf"}</span>
              <span className="min-w-0 flex-1 truncate">{customerName(d)}<span className="text-steel">{d.title ? ` · ${d.title}` : d.project ? ` · ${d.project.name}` : ""}</span></span>
              <span className="shrink-0 text-steel">{formatDate(d.date)}</span>
              <span className="w-28 shrink-0 text-right font-semibold">{fmtEuroCents(d.grossCents)}</span>
              <span className={clsx("chip w-28 shrink-0 justify-center", overdue ? TONE.UEBERFAELLIG : expired ? TONE.ABGELEHNT : TONE[d.status])}>{expired ? "abgelaufen" : statusText(d)}</span>
            </Link>
          );
        })}
      </section>
      <div className="flex flex-wrap items-center gap-3 text-sm text-steel">
        <span>{count} Belege · zusammen {fmtEuroCents(sum._sum.grossCents)}{conf.kind === "RECHNUNG" ? ` · offen ${fmtEuroCents((sum._sum.grossCents ?? 0) - (sum._sum.paidCents ?? 0))}` : ""}</span>
        <span className="ml-auto flex gap-2">
          {page > 0 && <Link href={href({ seite: page - 1 })} className="btn-secondary">Zurück</Link>}
          {(page + 1) * 50 < count && <Link href={href({ seite: page + 1 })} className="btn-secondary">Weiter</Link>}
        </span>
      </div>
    </main>
  );
}
