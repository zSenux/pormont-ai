import Link from "next/link";
import { FileText, Image as ImageIcon, Search, Sparkles, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { fileUrl, searchFiles } from "@/lib/files";
import { deleteFile } from "@/app/actions/work";
import { ActionButton } from "@/components/confirm-button";
import { Uploader } from "@/components/upload";

export const metadata = { title: "Dokumente" };
export const dynamic = "force-dynamic";

const KIND = { dokument: "Dokument", foto: "Baustellenfoto", beleg: "Beleg" } as Record<string, string>;

/** Treffer im Ausschnitt hervorheben (ohne HTML einzuschleusen) */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-ink">{part}</mark> : part))}</>;
}

export default async function DokumentePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = (await searchParams).q?.trim().slice(0, 100) ?? "";
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const results = q.length >= 2 ? await searchFiles(q, { take: 50 }) : null;
  const recent = results ? [] : await db.storedFile.findMany({ where: { kind: "dokument" }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, name: true, mime: true, size: true, kind: true, createdAt: true, text: true, project: { select: { id: true, name: true } } } });
  const count = await db.storedFile.count();

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Dokumente</h1>
        <p className="mt-1 text-sm text-steel">Durchsucht Namen und Inhalt aller PDFs, Belege und Notizen ({count} Dateien). Oder Jarvis fragen: „Such die Statik vom Schulhof-Geländer.“</p>
      </div>
      <form action="/dokumente" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Suchwort, z. B. Statik, Wartungsvertrag, Müller …" className="input min-w-0 flex-1" aria-label="Dokumente durchsuchen" autoFocus={!q} />
        <button className="btn-primary"><Search className="size-4" /> Suchen</button>
      </form>
      <div className="card p-4">
        <Uploader kind="dokument" label="PDF oder Datei hochladen" hint="max. 15 MB · Text in PDFs wird durchsuchbar" />
      </div>

      {results && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{results.length ? `${results.length} Treffer für „${q}“` : `Nichts gefunden für „${q}“`}</h2>
            {results.length > 0 && (
              <Link href={`/jarvis?q=${encodeURIComponent(`Durchsuch die Dokumente nach „${q}“ und fass zusammen, was drinsteht.`)}`} className="btn-secondary">
                <Sparkles className="size-4" /> Jarvis fassen lassen
              </Link>
            )}
          </div>
          <ul className="card divide-y divide-line">
            {results.map((f) => (
              <li key={f.id} className="flex gap-3 p-4">
                {f.mime.startsWith("image/") ? <ImageIcon className="mt-0.5 size-5 shrink-0 text-steel" /> : <FileText className="mt-0.5 size-5 shrink-0 text-steel" />}
                <div className="min-w-0 flex-1">
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="font-medium text-brand"><Highlight text={f.name} words={words} /></a>
                  <p className="text-xs text-steel">{KIND[f.kind] ?? f.kind} · {formatDate(f.createdAt)}{f.project && <> · <Link href={`/projekte/${f.project.id}`} className="underline">{f.project.name}</Link></>}</p>
                  {f.snippet && <p className="mt-1 text-sm text-ink/80"><Highlight text={f.snippet} words={words} /></p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!results && (
        <section className="space-y-2">
          <h2 className="font-semibold">Zuletzt hochgeladen</h2>
          <ul className="card divide-y divide-line">
            {recent.length === 0 && <li className="p-5 text-sm text-steel">Noch keine Dokumente.</li>}
            {recent.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-5 shrink-0 text-steel" />
                <div className="min-w-0 flex-1">
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="block truncate font-medium text-brand">{f.name}</a>
                  <p className="text-xs text-steel">
                    {formatDate(f.createdAt)} · {Math.max(1, Math.round(f.size / 1024))} KB{f.mime === "application/pdf" && !f.text && " · kein Text lesbar (Scan)"}
                    {f.project && <> · <Link href={`/projekte/${f.project.id}`} className="underline">{f.project.name}</Link></>}
                  </p>
                </div>
                <ActionButton action={deleteFile.bind(null, f.id)} confirm={`„${f.name}“ löschen?`} className="text-steel/60 hover:text-bad" title="Löschen">
                  <Trash2 className="size-4" />
                </ActionButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
