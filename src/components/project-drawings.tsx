import Link from "next/link";
import { PenTool } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { DRAWING_STATUS_LABEL, DRAWING_TONE, indexLetter, type DrawingStatus } from "@/lib/drawings-shared";
import { DrawingUpload } from "@/components/drawing-upload";

/** Zeichnungen eines Projekts (Projektakte, Auftrag, Fertigungskarte ohne Upload) */
export async function ProjectDrawings({ projectId, upload = true }: { projectId: string; upload?: boolean }) {
  const list = await db.drawing.findMany({ where: { projectId, ...(upload ? {} : { status: { not: "UNGUELTIG" } }) }, orderBy: [{ status: "asc" }, { number: "asc" }] });
  const released = list.filter((d) => d.releasedVersion).length;
  return (
    <section className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <PenTool className="size-4 text-brand" /> Zeichnungen
        <span className="ml-auto text-sm font-normal text-steel">{list.length ? `${released} von ${list.length} freigegeben` : ""}</span>
      </h2>
      <ul className="divide-y divide-line text-sm">
        {list.length === 0 && <li className="py-1 text-steel">Noch keine Zeichnungen.</li>}
        {list.map((d) => (
          <li key={d.id}>
            <Link href={`/zeichnungen/${d.id}`} className="flex items-center gap-2 py-2 hover:text-brand">
              <span className="w-24 shrink-0 text-xs font-semibold text-brand">{d.number}</span>
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="shrink-0 text-xs font-semibold">{upload ? `Index ${indexLetter(d.currentVersion)}` : d.releasedVersion ? `gültig: ${indexLetter(d.releasedVersion)}` : "nicht frei!"}</span>
              <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", DRAWING_TONE[d.status as DrawingStatus])}>{DRAWING_STATUS_LABEL[d.status as DrawingStatus] ?? d.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      {upload && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand">Zeichnung hochladen</summary>
          <div className="mt-3"><DrawingUpload projectId={projectId} /></div>
        </details>
      )}
    </section>
  );
}
