import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatEuro } from "@/lib/berlin";
import { ERP_KIND_LABEL, rawEntries, type ErpKind } from "@/lib/erp-import";
import { permalink } from "@/lib/lexware/client";

export const metadata = { title: "Datensatz" };
export const dynamic = "force-dynamic";

export default async function ErpRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const r = await db.erpRecord.findUnique({ where: { id: id.data }, include: { import: { select: { fileName: true } } } });
  if (!r) notFound();
  // lexId: Lexware-UUID (frühere Übernahme) oder ID in der eigenen Buchhaltung
  const fromLex = Boolean(r.lexId?.includes("-"));
  const lexLink = r.lexId && fromLex && r.kind === "kunde" ? permalink("contacts", r.lexId) : null;
  const ownLink = r.lexId && !fromLex ? (r.kind === "kunde" ? `/buchhaltung/kunden/${r.lexId}` : r.kind === "artikel" ? "/buchhaltung/artikel" : null) : null;
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href={`/datenuebernahme?art=${r.kind}`} className="flex w-fit items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Datenübernahme</Link>
      <div>
        <p className="text-sm text-steel">{ERP_KIND_LABEL[r.kind as ErpKind]} aus „{r.import.fileName}“ · {r.table}</p>
        <h1 className="page-title [overflow-wrap:anywhere]">{[r.number, r.party ?? r.name].filter(Boolean).join(" · ") || "(ohne Namen)"}</h1>
        <p className="mt-1 text-sm text-steel">{[r.party && r.name ? r.name : null, r.date ? formatDate(r.date) : null, r.status, r.amount !== null ? formatEuro(r.amount) : null].filter(Boolean).join(" · ")}</p>
      </div>
      {(lexLink || ownLink || r.projectId || r.error) && (
        <section className="card flex flex-wrap items-center gap-3 p-4 text-sm">
          {lexLink && <a href={lexLink} target="_blank" rel="noreferrer" className="btn-secondary"><ExternalLink className="size-4" /> In Lexware öffnen</a>}
          {ownLink && <Link href={ownLink} className="btn-secondary">In der Buchhaltung öffnen</Link>}
          {r.projectId && <Link href={`/projekte/${r.projectId}`} className="btn-secondary">Projekt öffnen</Link>}
          {r.error && <p className="text-bad">Übernahme fehlgeschlagen: {r.error}</p>}
        </section>
      )}
      <section className="card p-4">
        <h2 className="font-semibold">Alle Felder aus dem alten Programm</h2>
        <dl className="mt-2 divide-y divide-line text-sm">
          {rawEntries(r.raw).map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
              <dt className="text-steel [overflow-wrap:anywhere]">{k}</dt>
              <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
