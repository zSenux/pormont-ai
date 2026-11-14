import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { ASM_STATUS_LABEL, ASM_TONE, type AsmStatus } from "@/lib/assembly-shared";

/** Montagen eines Projekts (für Projektakte und Auftrag) */
export async function ProjectAssemblies({ projectId }: { projectId: string }) {
  const list = await db.assembly.findMany({ where: { projectId }, orderBy: { startAt: "asc" }, include: { leader: { select: { name: true } } } });
  return (
    <section className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4 text-brand" /> Montage</h2>
      <ul className="divide-y divide-line text-sm">
        {list.length === 0 && <li className="py-1 text-steel">Noch keine Montage geplant.</li>}
        {list.map((a) => (
          <li key={a.id}>
            <Link href={`/montage/${a.id}`} className="flex items-center gap-2 py-2 hover:text-brand">
              <span className="w-24 shrink-0 text-xs font-semibold text-brand">{a.number}</span>
              <span className="min-w-0 flex-1 truncate">{a.title}{a.leader && <span className="text-steel"> · {a.leader.name}</span>}</span>
              <span className="shrink-0 text-xs text-steel">{formatDate(a.startAt).slice(0, 6)}</span>
              <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", ASM_TONE[a.status as AsmStatus])}>{ASM_STATUS_LABEL[a.status as AsmStatus] ?? a.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/montage?projekt=${projectId}`} className="btn-secondary"><Plus className="size-4" /> Montage planen</Link>
    </section>
  );
}
