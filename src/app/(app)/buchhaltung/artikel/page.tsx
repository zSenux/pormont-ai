import { Package, Search, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { searchArticles } from "@/lib/buchhaltung/customers";
import { fmtPrice } from "@/lib/buchhaltung/money";
import { archiveArticleAction } from "@/app/actions/buchhaltung";
import { ActionButton } from "@/components/confirm-button";
import { ArticleForm } from "./form";

export const metadata = { title: "Artikel" };
export const dynamic = "force-dynamic";

export default async function ArtikelPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const list = await searchArticles(q, 300);
  return (
    <main className="space-y-4">
      <div>
        <h1 className="page-title">Artikel & Leistungen</h1>
        <p className="mt-1 text-sm text-steel">Standardpreise für Angebote und Rechnungen – im Beleg über „Artikel suchen“ einfügen. Jarvis kennt sie auch.</p>
      </div>
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Neuer Artikel</summary>
        <div className="mt-3"><ArticleForm /></div>
      </details>
      <form className="flex gap-2" action="/buchhaltung/artikel">
        <input name="q" defaultValue={q} placeholder="Suchen …" className="input min-w-0 flex-1" aria-label="Artikel suchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>
      <section className="card divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-steel">Keine Artikel.</p>}
        {list.map((a) => (
          <details key={a.id} className="p-3">
            <summary className="flex cursor-pointer items-center gap-3 text-sm">
              <Package className="size-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1"><span className="font-medium">{a.name}</span>{a.number && <span className="text-steel"> · Nr. {a.number}</span>}</span>
              <span className="shrink-0 font-semibold">{fmtPrice(a.priceNet)} / {a.unit}</span>
            </summary>
            <div className="mt-3 space-y-2">
              <ArticleForm a={a} />
              <ActionButton action={archiveArticleAction.bind(null, a.id)} confirm={`„${a.name}“ entfernen? Bestehende Belege bleiben unverändert.`} className="btn-secondary text-bad"><Trash2 className="size-4" /> Entfernen</ActionButton>
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
