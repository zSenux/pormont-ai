import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe, Mail, Phone } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { duplicates, listRowSchema } from "@/lib/akquise/liste";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/akquise/stages";
import { importLeadList } from "@/app/actions/akquise";

export const metadata = { title: "Liste importieren" };
export const dynamic = "force-dynamic";

export default async function ListePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await searchParams).id);
  if (!id.success) notFound();
  const imp = await db.leadImport.findUnique({ where: { id: id.data } });
  if (!imp) notFound();
  const rows = z.array(listRowSchema).parse(imp.rows);
  const mapping = z.record(z.string(), z.string()).parse(imp.mapping);
  const dup = await duplicates(rows);
  const fresh = dup.filter((d) => !d).length;

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-10">
      <Link href="/akquise" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Akquise</Link>
      <div>
        <h1 className="page-title">Liste „{imp.fileName}“</h1>
        <p className="mt-1 text-sm text-steel">{rows.length} Firmen erkannt, davon {fresh} neu. Haken setzen und übernehmen. Schon vorhandene sind ausgegraut.</p>
      </div>
      <details className="card p-3 text-sm">
        <summary className="cursor-pointer font-medium">Erkannte Spalten</summary>
        <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs text-steel sm:grid-cols-2">
          {Object.entries(mapping).map(([col, field]) => <li key={col}><span className="text-ink">{col}</span> → {field}</li>)}
          <li className="sm:col-span-2">Alle anderen Spalten (z. B. Priorität) stehen in der Notiz des Interessenten.</li>
        </ul>
      </details>
      <form action={importLeadList} className="space-y-3">
        <input type="hidden" name="importId" value={imp.id} />
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const d = dup[i];
            return (
              <li key={i}>
                <label className={clsx("card flex cursor-pointer items-start gap-3 p-3", d ? "opacity-50" : "hover:border-brand")}>
                  <input type="checkbox" name="row" value={i} disabled={Boolean(d)} defaultChecked={!d} className="mt-1 size-5 accent-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{r.name}{d && ("leadId" in d ? " · schon in der Akquise" : " · doppelt in der Liste")}</span>
                      {r.stage !== "NEU" && <span className={clsx("chip shrink-0 px-2 py-0.5 text-[11px]", STAGE_TONE[r.stage])}>{STAGE_LABEL[r.stage]}</span>}
                    </span>
                    <span className="block truncate text-xs text-steel">{[r.category, r.contactName, [r.postalCode, r.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "–"}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-steel">
                      {r.phone && <span className="flex items-center gap-1"><Phone className="size-3" />{r.phone}</span>}
                      {r.email && <span className="flex items-center gap-1"><Mail className="size-3" />{r.email}</span>}
                      {r.website && <span className="flex items-center gap-1"><Globe className="size-3" />{r.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>}
                    </span>
                    {r.extra.length > 0 && <span className="mt-1 block truncate text-xs text-steel">{r.extra.join(" · ")}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-20 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <button className="btn-primary" disabled={!fresh}>Ausgewählte übernehmen</button>
          <span className="text-xs text-steel">Werbe-Mails nur mit Einwilligung (§ 7 UWG) – Anrufe und Briefe gehen.</span>
        </div>
      </form>
    </main>
  );
}
