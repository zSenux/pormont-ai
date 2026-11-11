import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe, Star } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { isSocialOnly, placeResultSchema } from "@/lib/akquise/places";
import { importLeads, moreResults } from "@/app/actions/akquise";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Suchergebnis" };
export const dynamic = "force-dynamic";

export default async function SuchePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await searchParams).id);
  if (!id.success) notFound();
  const s = await db.leadSearch.findUnique({ where: { id: id.data } });
  if (!s) notFound();
  const results = z.array(placeResultSchema).parse(s.results);
  const known = new Set((await db.lead.findMany({ where: { placeId: { in: results.map((r) => r.placeId) } }, select: { placeId: true } })).map((l) => l.placeId));

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-10">
      <Link href="/akquise" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Akquise</Link>
      <div>
        <h1 className="page-title">„{s.query}“ in {s.location}</h1>
        <p className="mt-1 text-sm text-steel">{results.length} Treffer · Haken setzen und übernehmen. Schon übernommene sind ausgegraut.</p>
      </div>
      <form action={importLeads} className="space-y-3">
        <input type="hidden" name="searchId" value={s.id} />
        <ul className="space-y-2">
          {results.map((r) => {
            const has = known.has(r.placeId);
            return (
              <li key={r.placeId}>
                <label className={`card flex cursor-pointer items-start gap-3 p-3 ${has ? "opacity-50" : "hover:border-brand"}`}>
                  <input type="checkbox" name="placeId" value={r.placeId} disabled={has} defaultChecked={!has} className="mt-1 size-5 accent-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}{has && " · schon übernommen"}</span>
                    <span className="block truncate text-xs text-steel">{[r.category, r.address].filter(Boolean).join(" · ")}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-steel">
                      {r.phone && <span>{r.phone}</span>}
                      {r.website ? <span className="flex items-center gap-1"><Globe className="size-3" />{isSocialOnly(r.website) ? "nur Social Media" : new URL(r.website).hostname.replace(/^www\./, "")}</span> : <span>keine Website</span>}
                      {r.rating !== null && <span className="flex items-center gap-1"><Star className="size-3" />{r.rating} ({r.reviews ?? 0})</span>}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-20 flex flex-wrap gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <button className="btn-primary">Ausgewählte übernehmen</button>
          {s.nextPageToken && <ActionButton action={moreResults.bind(null, s.id)}>Weitere 20 laden</ActionButton>}
        </div>
      </form>
    </main>
  );
}
