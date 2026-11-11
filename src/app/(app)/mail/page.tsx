import Link from "next/link";
import { Mail, Paperclip, Search, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { formatDateTime } from "@/lib/berlin";
import { listMails, MailError } from "@/lib/mail/client";
import { mailConfig } from "@/lib/mail/config";

export const metadata = { title: "Mail" };
export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const cfg = mailConfig();
  const unread = sp.filter === "ungelesen";
  const q = sp.q?.trim().slice(0, 100) || undefined;

  let data: Awaited<ReturnType<typeof listMails>> | null = null;
  let error: string | null = null;
  if (cfg) {
    try {
      data = await listMails({ unread, search: q && q.length >= 2 ? q : undefined, limit: 50 });
    } catch (e) {
      error = e instanceof MailError ? e.message : "Postfach nicht erreichbar.";
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Mail</h1>
          <p className="mt-1 text-sm text-steel">{cfg ? `${cfg.user} · ${cfg.provider}` : "Postfach noch nicht verbunden"}</p>
        </div>
        {cfg && (
          <Link href="/jarvis?q=Fasse%20meine%20ungelesenen%20Mails%20zusammen%20und%20sag%20mir%2C%20was%20wichtig%20ist." className="btn-primary">
            <Sparkles className="size-4" /> Ungelesene zusammenfassen
          </Link>
        )}
      </div>

      {!cfg && (
        <div className="card space-y-2 p-5 text-sm">
          <p className="font-semibold">So wird das Postfach verbunden</p>
          <p className="text-steel">
            Der Administrator trägt auf dem Server <code>MAIL_PROVIDER</code> (strato oder gmx), <code>MAIL_USER</code> (die E-Mail-Adresse) und <code>MAIL_PASSWORD</code> ein. Bei GMX muss vorher in den GMX-Einstellungen
            „POP3/IMAP Abruf“ erlaubt sein.
          </p>
        </div>
      )}

      {cfg && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "", label: "Alle" },
              { key: "ungelesen", label: `Ungelesen${data ? ` (${data.unread})` : ""}` },
            ].map((f) => (
              <Link key={f.key} href={f.key ? `/mail?filter=${f.key}` : "/mail"} className={clsx("chip px-3 py-1", (sp.filter ?? "") === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
                {f.label}
              </Link>
            ))}
            <form className="ml-auto flex min-w-0 flex-[1_1_220px] items-center gap-2" action="/mail">
              {unread && <input type="hidden" name="filter" value="ungelesen" />}
              <input name="q" defaultValue={q} placeholder="Absender, Betreff, Text …" className="input min-w-0 flex-1" aria-label="Mails durchsuchen" />
              <button className="btn-secondary" aria-label="Suchen">
                <Search className="size-4" />
              </button>
            </form>
          </div>

          {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-bad">{error}</div>}

          {data && (
            <ul className="card divide-y divide-line">
              {data.mails.length === 0 && <li className="p-5 text-sm text-steel">Keine Mails gefunden.</li>}
              {data.mails.map((m) => (
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
          )}
          {data && <p className="flex items-center gap-2 text-xs text-steel"><Mail className="size-3.5" /> {data.total} Mails im Posteingang · die neuesten 50 werden gezeigt</p>}
        </>
      )}
    </main>
  );
}
