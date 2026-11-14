import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { readChecklist, readDefects } from "@/lib/assembly-shared";
import { PrintButton } from "@/components/print-button";
import { SignaturePad } from "@/components/signature-pad";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await db.assembly.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: a ? `Abnahmeprotokoll ${a.number}` : "Abnahmeprotokoll" };
}

/** Abnahmeprotokoll zum Ausdrucken bzw. digital unterschreiben (Handy/Tablet beim Kunden) */
export default async function Abnahmeprotokoll({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const a = await db.assembly.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, customer: true, address: true, customerRef: { select: { name: true, contactName: true, street: true, zip: true, city: true } }, order: { select: { number: true } } } },
      leader: { select: { name: true } },
      crew: { include: { user: { select: { name: true } } } },
      files: { where: { mime: { startsWith: "image/" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, meta: true } },
    },
  });
  if (!a) notFound();
  const checklist = readChecklist(a.checklist);
  const defects = readDefects(a.defects);
  const after = a.files.filter((f) => (f.meta as { phase?: string } | null)?.phase !== "vorher").slice(0, 6);
  const cust = a.project.customerRef;
  const team = [a.leader?.name, ...a.crew.map((c) => c.user.name)].filter((n, i, all): n is string => Boolean(n) && all.indexOf(n) === i);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/montage/${a.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Zur Montage</Link>
        <PrintButton label="Drucken / als PDF" />
      </div>

      <article className="card space-y-5 p-6 print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-sm font-semibold text-brand">Abnahmeprotokoll {a.number}</p>
            <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
            <p className="text-sm text-steel">{a.project.name}{a.project.order && ` · Auftrag ${a.project.order.number}`}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="ProMont GmbH" className="h-10 w-auto shrink-0" />
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-steel">Auftraggeber</dt><dd className="font-medium">{cust?.name ?? a.project.customer ?? "–"}{cust?.contactName && <span className="block font-normal">{cust.contactName}</span>}{cust?.street && <span className="block font-normal">{cust.street}, {cust.zip} {cust.city}</span>}</dd></div>
          <div><dt className="text-xs text-steel">Montageort</dt><dd className="font-medium">{a.address ?? a.project.address ?? "–"}</dd></div>
          <div><dt className="text-xs text-steel">Montage</dt><dd className="font-medium">{formatDate(a.startAt)}{a.endAt && formatDate(a.endAt) !== formatDate(a.startAt) && ` – ${formatDate(a.endAt)}`}</dd></div>
          <div><dt className="text-xs text-steel">Monteure ProMont</dt><dd className="font-medium">{team.join(", ") || "–"}</dd></div>
        </dl>

        <section>
          <h2 className="mb-1 font-semibold">Ausgeführte Leistung</h2>
          <p className="whitespace-pre-line text-sm">{a.report || a.plan || "Montage gemäß Auftrag."}</p>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">Prüfpunkte</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {checklist.map((c, i) => <li key={i} className="flex gap-2"><span className="font-mono">{c.done ? "☑" : "☐"}</span>{c.text}</li>)}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">Festgestellte Mängel</h2>
          {defects.length === 0 ? <p className="text-sm">Keine Mängel festgestellt.</p> : (
            <ol className="list-decimal space-y-0.5 pl-5 text-sm">
              {defects.map((d, i) => <li key={i}>{d.text} <span className="text-steel">({d.fixed ? "behoben" : "offen, wird nachgebessert"})</span></li>)}
            </ol>
          )}
        </section>

        {after.length > 0 && (
          <section className="print:break-inside-avoid">
            <h2 className="mb-2 font-semibold">Fotos</h2>
            <div className="grid grid-cols-3 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {after.map((f) => <img key={f.id} src={fileUrl(f.id)} alt={f.name} className="aspect-[4/3] w-full rounded-lg object-cover" />)}
            </div>
          </section>
        )}

        <section className="space-y-3 border-t border-line pt-4 print:break-inside-avoid">
          <p className="text-sm">Der Auftraggeber bestätigt, dass die oben genannte Leistung ausgeführt und {defects.some((d) => !d.fixed) ? "unter dem Vorbehalt der aufgeführten Mängel " : ""}abgenommen wurde.</p>
          {a.signedAt && a.signatureData ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.signatureData} alt={`Unterschrift ${a.signerName}`} className="h-24 w-auto" />
                <p className="border-t border-ink pt-1 text-sm">{a.signerName}, Auftraggeber · {formatDateTime(a.signedAt)}</p>
              </div>
              <div className="flex flex-col justify-end">
                <p className="border-t border-ink pt-1 text-sm">{a.leader?.name ?? "ProMont GmbH"}, Montageleitung</p>
              </div>
              {a.acceptanceNote && <p className="text-sm sm:col-span-2"><strong>Anmerkung des Kunden:</strong> {a.acceptanceNote}</p>}
            </div>
          ) : (
            <>
              <div className="print:hidden"><SignaturePad assemblyId={a.id} defaultName={cust?.contactName ?? null} /></div>
              <div className="hidden grid-cols-2 gap-6 pt-12 print:grid">
                <p className="border-t border-ink pt-1 text-sm">Ort, Datum, Unterschrift Auftraggeber</p>
                <p className="border-t border-ink pt-1 text-sm">Unterschrift ProMont GmbH</p>
              </div>
            </>
          )}
        </section>
      </article>
    </main>
  );
}
