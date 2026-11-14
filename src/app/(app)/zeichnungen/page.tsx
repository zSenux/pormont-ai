import Link from "next/link";
import { PenTool } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { DRAWING_KIND_LABEL, DRAWING_STATUS_LABEL, DRAWING_STATUSES, DRAWING_TONE, indexLetter, type DrawingKind, type DrawingStatus } from "@/lib/drawings-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zeichnungen" };

export default async function Zeichnungen({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const status = DRAWING_STATUSES.includes(sp.status as DrawingStatus) ? (sp.status as DrawingStatus) : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const [list, counts] = await Promise.all([
    db.drawing.findMany({
      where: { ...(status ? { status } : { status: { not: "UNGUELTIG" } }), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }, { project: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { project: { select: { id: true, name: true } } },
    }),
    db.drawing.groupBy({ by: ["status"], _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Zeichnungen</h1>
        <p className="mt-1 text-sm text-steel">Werkpläne, Details, Statik und Montagepläne mit Index (A, B, C …) und Freigabe. Die Werkstatt sieht immer den zuletzt freigegebenen Index. Neue Zeichnungen lädst du in der Projektakte hoch.</p>
      </div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Suchen: Titel, Nummer, Projekt" className="input min-w-0 flex-1" aria-label="Suchen" />
        {status && <input type="hidden" name="status" value={status} />}
        <button className="btn-secondary">Suchen</button>
      </form>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter">
        <Link href="/zeichnungen" className={clsx("chip px-3 py-1", !status ? "border-brand bg-brand text-white" : "bg-white")}>Alle gültigen</Link>
        {DRAWING_STATUSES.map((s) => (
          <Link key={s} href={`/zeichnungen?status=${s}`} className={clsx("chip px-3 py-1", status === s ? "border-brand bg-brand text-white" : "bg-white")}>{DRAWING_STATUS_LABEL[s]} ({n(s)})</Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <p className="card p-5 text-sm text-steel">Keine Zeichnungen gefunden.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={`/zeichnungen/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-mist/50">
                <PenTool className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-steel">{d.number} · {DRAWING_KIND_LABEL[d.kind as DrawingKind] ?? d.kind} · {d.project.name} · {formatDate(d.updatedAt)}</span>
                </span>
                <span className="text-sm font-semibold">Index {indexLetter(d.currentVersion)}</span>
                {d.releasedVersion && d.releasedVersion !== d.currentVersion && <span className="text-xs text-steel">frei: {indexLetter(d.releasedVersion)}</span>}
                <span className={clsx("chip px-2 py-0.5 text-[11px]", DRAWING_TONE[d.status as DrawingStatus])}>{DRAWING_STATUS_LABEL[d.status as DrawingStatus] ?? d.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
