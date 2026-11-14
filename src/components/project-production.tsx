import Link from "next/link";
import { Factory, Plus } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { PROD_LABEL, PROD_TONE, type ProdStatus } from "@/lib/production-shared";

/** Fertigungsaufträge eines Projekts (für Projektakte und Auftrag) */
export async function ProjectProduction({ projectId }: { projectId: string }) {
  const jobs = await db.productionJob.findMany({ where: { projectId }, orderBy: [{ plannedEnd: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { assignee: { select: { name: true } } } });
  const done = jobs.filter((j) => j.status === "FERTIG" || j.status === "MONTAGEBEREIT").length;
  return (
    <section className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Factory className="size-4 text-brand" /> Fertigung
        <span className="ml-auto text-sm font-normal text-steel">{jobs.length ? `${done} von ${jobs.length} fertig` : ""}</span>
      </h2>
      <ul className="divide-y divide-line text-sm">
        {jobs.length === 0 && <li className="py-1 text-steel">Noch keine Fertigungsaufträge.</li>}
        {jobs.map((j) => (
          <li key={j.id}>
            <Link href={`/fertigung/${j.id}`} className="flex items-center gap-2 py-2 hover:text-brand">
              <span className="w-24 shrink-0 text-xs font-semibold text-brand">{j.number}</span>
              <span className="min-w-0 flex-1 truncate">{j.title}{j.assignee && <span className="text-steel"> · {j.assignee.name}</span>}</span>
              {j.plannedEnd && <span className="shrink-0 text-xs text-steel">{formatDate(j.plannedEnd).slice(0, 6)}</span>}
              <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", PROD_TONE[j.status as ProdStatus])}>{PROD_LABEL[j.status as ProdStatus] ?? j.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/fertigung?projekt=${projectId}`} className="btn-secondary"><Plus className="size-4" /> Fertigungsauftrag anlegen</Link>
    </section>
  );
}
