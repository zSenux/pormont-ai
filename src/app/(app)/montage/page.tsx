import Link from "next/link";
import { CalendarDays, MapPin, Plus, Truck, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate } from "@/lib/berlin";
import { timeHm } from "@/lib/calendar";
import { ASM_STATUS_LABEL, ASM_TONE, readChecklist, type AsmStatus } from "@/lib/assembly-shared";
import { newAssembly } from "@/app/actions/montage";
import { AssemblyFields } from "@/components/assembly-form";

export const metadata = { title: "Montage" };
export const dynamic = "force-dynamic";

const WEEKDAY: Record<string, string> = { Mon: "Mo", Tue: "Di", Wed: "Mi", Thu: "Do", Fri: "Fr", Sat: "Sa", Sun: "So" };

export default async function MontagePage({ searchParams }: { searchParams: Promise<{ filter?: string; projekt?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = sp.filter ?? "alle";
  const since = new Date(Date.now() - 7 * 86400_000);
  const [list, projects, users, vehicles] = await Promise.all([
    db.assembly.findMany({
      where: {
        OR: [{ status: { in: ["GEPLANT", "LAEUFT", "ERLEDIGT"] } }, { startAt: { gte: since } }],
        ...(filter === "meine" ? { AND: [{ OR: [{ leaderId: me.id }, { crew: { some: { userId: me.id } } }] }] } : {}),
      },
      orderBy: { startAt: "asc" },
      take: 200,
      include: { project: { select: { id: true, name: true, customer: true } }, leader: { select: { name: true } }, crew: { include: { user: { select: { name: true } } } } },
    }),
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true, order: { select: { number: true } } } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.assembly.findMany({ where: { vehicle: { not: null } }, distinct: ["vehicle"], select: { vehicle: true }, take: 20 }),
  ]);
  const days = [...list.reduce((m, a) => m.set(berlinParts(a.startAt).ymd, [...(m.get(berlinParts(a.startAt).ymd) ?? []), a]), new Map<string, typeof list>())];

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Montage</h1>
        <p className="mt-1 text-sm text-steel">Montagetermine mit Team, Fahrzeug, Checkliste, Fotos, Bericht und Abnahme mit Unterschrift – gemacht fürs Handy auf der Baustelle.</p>
      </div>

      <details className="card p-4" open={Boolean(sp.projekt)}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Montage planen</summary>
        <form action={newAssembly} className="mt-3 grid gap-2 sm:grid-cols-2">
          <select name="projectId" required defaultValue={sp.projekt ?? ""} className="input sm:col-span-2" aria-label="Projekt">
            <option value="" disabled>Projekt / Auftrag</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.order ? `${p.order.number} · ` : ""}{p.name}</option>)}
          </select>
          <AssemblyFields a={null} users={users} vehicles={vehicles.map((v) => v.vehicle!).filter(Boolean)} />
          <button className="btn-primary sm:col-span-2 sm:justify-self-end">Montage anlegen</button>
        </form>
      </details>

      <div className="flex gap-2">
        {[{ key: "alle", label: "Alle" }, { key: "meine", label: "Meine Montagen" }].map((f) => (
          <Link key={f.key} href={`/montage?filter=${f.key}`} className={clsx("chip px-3 py-1", filter === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{f.label}</Link>
        ))}
      </div>

      {days.length === 0 && <p className="card p-5 text-sm text-steel">Keine Montagen geplant.</p>}
      {days.map(([ymd, items]) => {
        const p = berlinParts(items[0].startAt);
        return (
          <section key={ymd} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-steel"><CalendarDays className="size-4" /> {WEEKDAY[p.weekday] ?? p.weekday}, {formatDate(items[0].startAt)}</h2>
            <ul className="space-y-2">
              {items.map((a) => {
                const st = a.status as AsmStatus;
                const cl = readChecklist(a.checklist);
                return (
                  <li key={a.id}>
                    <Link href={`/montage/${a.id}`} className="card block space-y-1.5 p-4 transition hover:border-brand">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-brand">{a.number} · {timeHm(a.startAt)}{a.endAt && `–${berlinParts(a.endAt).ymd === ymd ? timeHm(a.endAt) : formatDate(a.endAt).slice(0, 6)}`}</p>
                          <h3 className="font-semibold leading-snug">{a.title}</h3>
                          <p className="truncate text-sm text-steel">{a.project.name}{a.project.customer && ` · ${a.project.customer}`}</p>
                        </div>
                        <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", ASM_TONE[st])}>{ASM_STATUS_LABEL[st] ?? st}</span>
                      </div>
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-steel">
                        {a.address && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{a.address}</span>}
                        {a.crew.length > 0 && <span className="flex items-center gap-1"><Users className="size-3.5" />{[a.leader?.name, ...a.crew.map((c) => c.user.name).filter((n) => n !== a.leader?.name)].filter(Boolean).join(", ")}</span>}
                        {a.vehicle && <span className="flex items-center gap-1"><Truck className="size-3.5" />{a.vehicle}</span>}
                        <span>Checkliste {cl.filter((c) => c.done).length}/{cl.length}</span>
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
