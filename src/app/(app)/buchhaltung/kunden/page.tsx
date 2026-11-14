import Link from "next/link";
import { Building2, Search, User, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { searchCustomers } from "@/lib/buchhaltung/customers";
import { fmtEuroCents } from "@/lib/buchhaltung/money";

export const metadata = { title: "Kunden" };
export const dynamic = "force-dynamic";

export default async function KundenPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const list = await searchCustomers(q, 200);
  const open = await db.salesDoc.groupBy({ by: ["customerId"], where: { kind: "RECHNUNG", status: "OFFEN", customerId: { in: list.map((c) => c.id) } }, _sum: { grossCents: true, paidCents: true } });
  const openOf = (id: string) => { const o = open.find((x) => x.customerId === id); return o ? (o._sum.grossCents ?? 0) - (o._sum.paidCents ?? 0) : 0; };
  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">Kunden</h1>
        <Link href="/buchhaltung/kunden/neu" className="btn-primary"><UserPlus className="size-4" /> Kunde anlegen</Link>
      </div>
      <form className="flex gap-2" action="/buchhaltung/kunden">
        <input name="q" defaultValue={q} placeholder="Name, Ort, E-Mail oder Kundennummer …" className="input min-w-0 flex-1" aria-label="Kunden suchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>
      <section className="card divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-steel">{q ? "Kein Kunde gefunden." : "Noch keine Kunden."}</p>}
        {list.map((c) => (
          <Link key={c.id} href={`/buchhaltung/kunden/${c.id}`} className="flex items-center gap-3 p-3 text-sm hover:bg-mist/60">
            {c.kind === "FIRMA" ? <Building2 className="size-4 shrink-0 text-brand" /> : <User className="size-4 shrink-0 text-brand" />}
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-steel">{[c.number ? `Kd.-Nr. ${c.number}` : null, c.contactName, [c.zip, c.city].filter(Boolean).join(" "), c.email].filter(Boolean).join(" · ") || "–"}</span></span>
            {openOf(c.id) > 0 && <span className="shrink-0 text-xs font-semibold text-warn">offen {fmtEuroCents(openOf(c.id))}</span>}
          </Link>
        ))}
      </section>
    </main>
  );
}
