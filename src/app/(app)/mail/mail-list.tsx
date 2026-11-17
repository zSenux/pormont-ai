"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, Loader2, Mail, Paperclip } from "lucide-react";
import { clsx } from "clsx";
import { formatDateTime } from "@/lib/berlin";
import type { MailFolder, MailSummary } from "@/lib/mail/types";

/** Ordner-Auswahl: wechselt sofort die Liste */
export function FolderSelect({ folders, current }: { folders: MailFolder[]; current: string }) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 items-center gap-2">
      <Folder className="size-4 shrink-0 text-steel" />
      <span className="sr-only">Ordner</span>
      <select className="input min-w-0 py-1.5" value={current} onChange={(e) => router.push(e.target.value ? `/mail?ordner=${e.target.value}` : "/mail")}>
        {folders.map((f) => (
          <option key={f.key || "inbox"} value={f.key}>
            {"  ".repeat(f.depth)}
            {f.name}
            {f.unread ? ` (${f.unread} neu)` : ""} · {f.total}
          </option>
        ))}
      </select>
    </label>
  );
}

type Props = {
  initial: MailSummary[];
  next: string | null;
  /** Abfrage-Parameter für das Nachladen (ordner, q, filter, alle) */
  query: Record<string, string>;
  total: number;
  hits: number | null;
  folderName: string;
  showFolderHint: boolean;
};

/** Mail-Liste mit Nachladen beim Scrollen (und Knopf als Rückfall) */
export function MailList({ initial, next: firstNext, query, total, hits, folderName, showFolderHint }: Props) {
  const [mails, setMails] = useState(initial);
  const [next, setNext] = useState(firstNext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const more = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mail/liste?${new URLSearchParams({ ...query, weiter: next })}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { mails?: MailSummary[]; next?: string | null; error?: string };
      if (!res.ok || !j.mails) throw new Error(j.error ?? "Weitere Mails konnten nicht geladen werden.");
      setMails((m) => {
        const seen = new Set(m.map((x) => x.uid));
        return [...m, ...j.mails!.filter((x) => !seen.has(x.uid))];
      });
      setNext(j.next ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [next, query]);

  // Endlos-Scrollen: kurz vor dem Ende automatisch weiterladen (nicht nach einem Fehler)
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || error) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && more(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, next, error]);

  const count = hits ?? total;
  return (
    <>
      <ul className="card divide-y divide-line">
        {mails.length === 0 && <li className="p-5 text-sm text-steel">Keine Mails gefunden.</li>}
        {mails.map((m) => (
          <li key={m.uid}>
            <Link href={`/mail/${m.uid}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-mist">
              <span className={clsx("mt-1.5 size-2.5 shrink-0 rounded-full", m.seen ? "bg-transparent" : "bg-brand")} aria-label={m.seen ? undefined : "ungelesen"} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={clsx("truncate", !m.seen && "font-semibold")}>{m.from}</span>
                  <span className="shrink-0 text-xs text-steel">{m.date ? formatDateTime(m.date) : ""}</span>
                </span>
                <span className={clsx("flex items-center gap-1 truncate text-sm", m.seen ? "text-steel" : "text-ink")}>
                  {m.hasAttachments && <Paperclip className="size-3.5 shrink-0" />}
                  <span className="truncate">{m.subject}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {error && <div className="card border-red-200 bg-red-50 p-3 text-sm text-bad">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-steel">
          <Mail className="size-3.5" />
          {hits !== null || query.q
            ? `${mails.length}${hits !== null ? ` von ${hits}` : ""} Treffer in ${folderName === "allen Ordnern" ? "allen Ordnern" : `„${folderName}“`}${showFolderHint ? " · Tipp: „alle Ordner“ anhaken" : ""}`
            : `${mails.length} von ${count} Mails in „${folderName}“ geladen`}
        </p>
        {next && (
          <button type="button" className="btn-secondary" onClick={more} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null} {loading ? "Lädt …" : "Weitere Mails laden"}
          </button>
        )}
        {!next && mails.length > 0 && <p className="text-xs text-steel">Alle Mails geladen.</p>}
      </div>
    </>
  );
}
