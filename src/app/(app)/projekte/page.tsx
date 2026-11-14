import Link from "next/link";
import { FolderPlus, MapPin } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { formatHours } from "@/lib/hours";
import { STATUS_LABEL, STATUS_TONE, type ProjectStatusKey } from "@/lib/projects";
import { createProject } from "@/app/actions/work";
import { currentPhase, phaseTitle, progressOf } from "@/lib/phases";
import { ProgressBar } from "@/components/progress-bar";

export const metadata = { title: "Projekte" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "aktiv", label: "Aktiv" },
  { key: "fertig", label: "Fertig" },
  { key: "alle", label: "Alle" },
];

export default async function ProjektePage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireUser();
  const filter = (await searchParams).filter ?? "aktiv";
  const where = filter === "fertig" ? { status: "FERTIG" as const } : filter === "alle" ? {} : { status: { not: "FERTIG" as const } };
  const projects = await db.project.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: { _count: { select: { notes: true, files: true } }, leader: { select: { name: true } }, phases: { select: { key: true, status: true, sort: true } } },
  });
  const minutes = await db.timeEntry.groupBy({ by: ["projectId"], _sum: { minutes: true }, where: { projectId: { in: projects.map((p) => p.id) } } });
  const mins = new Map(minutes.map((m) => [m.projectId, m._sum.minutes ?? 0]));

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Projekte & Baustellen</h1>
        <p className="mt-1 text-sm text-steel">Baustellentagebuch mit Fotos, Stunden je Mitarbeiter, Termine und Dokumente an einem Ort.</p>
      </div>

      <details className="card p-4" open={projects.length === 0 && filter === "aktiv"}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold">
          <FolderPlus className="size-4 text-brand" /> Neues Projekt
        </summary>
        <form action={createProject} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="name" required minLength={2} placeholder="Name, z. B. „Außentreppe MFH Käfertal“" className="input sm:col-span-2" aria-label="Name" />
          <input name="customer" placeholder="Kunde" className="input" aria-label="Kunde" />
          <input name="address" placeholder="Adresse der Baustelle" className="input" aria-label="Adresse" />
          <label className="text-xs text-steel">Beginn<input name="startDate" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Ende (geplant)<input name="endDate" type="date" className="input mt-1 w-full" /></label>
          <textarea name="description" rows={2} placeholder="Beschreibung / Leistung" className="input resize-y sm:col-span-2" aria-label="Beschreibung" />
          <button className="btn-primary sm:col-span-2 sm:justify-self-end">Anlegen</button>
        </form>
      </details>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/projekte?filter=${f.key}`} className={clsx("chip px-3 py-1", filter === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
            {f.label}
          </Link>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {projects.length === 0 && <li className="card p-5 text-sm text-steel sm:col-span-2">Keine Projekte.</li>}
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projekte/${p.id}`} className="card block h-full space-y-2 p-4 transition hover:border-brand">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold leading-snug">{p.name}</h2>
                <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", STATUS_TONE[p.status as ProjectStatusKey])}>{STATUS_LABEL[p.status as ProjectStatusKey]}</span>
              </div>
              {(p.customer || p.leader) && <p className="text-sm text-steel">{[p.customer, p.leader && `PL ${p.leader.name}`].filter(Boolean).join(" · ")}</p>}
              {p.phases.length > 0 && (() => {
                const cur = currentPhase(p.phases);
                const pct = progressOf(p.phases);
                return (
                  <div className="space-y-1">
                    <ProgressBar pct={pct} />
                    <p className="text-xs text-steel">{pct} % · {cur ? phaseTitle(cur.key) : "abgeschlossen"}</p>
                  </div>
                );
              })()}
              {p.address && <p className="flex items-center gap-1 text-xs text-steel"><MapPin className="size-3" /> {p.address}</p>}
              <p className="text-xs text-steel">
                {formatHours(mins.get(p.id) ?? 0)} · {p._count.notes} Einträge · {p._count.files} Dateien
                {p.endDate && ` · bis ${formatDate(p.endDate)}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
