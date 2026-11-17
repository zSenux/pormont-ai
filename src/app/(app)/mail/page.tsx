import Link from "next/link";
import { PenSquare, Search, Signature, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { listFolders, listMails, MailError, type MailFolder } from "@/lib/mail/client";
import { mailAddress, mailConfig } from "@/lib/mail/config";
import { validKey } from "@/lib/mail/types";
import { FolderSelect, MailList } from "./mail-list";

export const metadata = { title: "Mail" };
export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; gesendet?: string; ordner?: string; alle?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const cfg = mailConfig();
  const unread = sp.filter === "ungelesen";
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const search = q && q.length >= 2 ? q : undefined;
  const folder = typeof sp.ordner === "string" && validKey(sp.ordner) ? sp.ordner : "";
  const all = Boolean(search && sp.alle === "1");

  let data: Awaited<ReturnType<typeof listMails>> | null = null;
  let folders: MailFolder[] = [];
  let error: string | null = null;
  if (cfg) {
    const [list, fl] = await Promise.allSettled([listMails({ unread, search, folder: folder || undefined, allFolders: all, limit: 50 }), listFolders()]);
    if (list.status === "fulfilled") data = list.value;
    else error = list.reason instanceof MailError ? list.reason.message : "Postfach nicht erreichbar.";
    // Ordnerliste ist Zusatz – fehlt sie, bleibt die Liste trotzdem nutzbar
    if (fl.status === "fulfilled") folders = fl.value;
  }
  if (!folders.length) folders = [{ key: "", name: "Posteingang", total: data?.total ?? 0, unread: data?.unread ?? 0, kind: "inbox", depth: 0 }];
  if (folder && !folders.some((f) => f.key === folder)) folders.push({ key: folder, name: data?.folderName ?? "Ordner", total: data?.total ?? 0, unread: data?.unread ?? 0, kind: null, depth: 0 });
  const query: Record<string, string> = {};
  if (folder) query.ordner = folder;
  if (search) query.q = search;
  if (unread) query.filter = "ungelesen";
  if (all) query.alle = "1";
  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(folder ? { ordner: folder } : {}), ...extra });
    return p.size ? `/mail?${p}` : "/mail";
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Mail</h1>
          <p className="mt-1 text-sm text-steel">{cfg ? `${mailAddress(cfg)} · ${cfg.provider}` : "Postfach noch nicht verbunden"}</p>
        </div>
        {cfg && (
          <div className="flex flex-wrap gap-2">
          <Link href="/mail/signatur" className="btn-secondary" title="Mail-Signatur">
            <Signature className="size-4" /> Signatur
          </Link>
          <Link href="/mail/neu" className="btn-primary">
            <PenSquare className="size-4" /> Neue Mail
          </Link>
          <Link href="/jarvis?q=Fasse%20meine%20ungelesenen%20Mails%20zusammen%20und%20sag%20mir%2C%20was%20wichtig%20ist." className="btn-secondary">
            <Sparkles className="size-4" /> Ungelesene zusammenfassen
          </Link>
          </div>
        )}
      </div>

      {!cfg && (
        <div className="card space-y-2 p-5 text-sm">
          <p className="font-semibold">So wird das Postfach verbunden</p>
          <p className="text-steel">
            Ein Administrator verbindet das Postfach unter <Link href="/einstellungen#verbindungen" className="font-medium text-brand">Einstellungen → Verbindungen</Link>: Strato, GMX oder IONOS mit E-Mail-Adresse und Passwort,
            oder Microsoft 365 / Outlook per „Mit Microsoft anmelden“.
          </p>
        </div>
      )}

      {cfg && sp.gesendet === "1" && <div className="card border-green-200 bg-green-50 p-3 text-sm text-green-800">Mail gesendet.</div>}

      {cfg && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FolderSelect folders={folders} current={folder} />
            {[
              { key: "", label: "Alle" },
              { key: "ungelesen", label: `Ungelesen${data ? ` (${data.unread})` : ""}` },
            ].map((f) => (
              <Link key={f.key} href={link(f.key ? { filter: f.key } : {})} className={clsx("chip px-3 py-1", (sp.filter ?? "") === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
                {f.label}
              </Link>
            ))}
          </div>
          <form className="flex flex-wrap items-center gap-2" action="/mail">
            {folder && <input type="hidden" name="ordner" value={folder} />}
            {unread && <input type="hidden" name="filter" value="ungelesen" />}
            <input name="q" defaultValue={q} placeholder="Ganzes Postfach durchsuchen: Absender, Betreff, Text …" className="input min-w-0 flex-[1_1_240px]" aria-label="Mails durchsuchen" />
            <label className="flex items-center gap-1.5 text-sm text-steel">
              <input type="checkbox" name="alle" value="1" defaultChecked={!q || all} className="size-4 accent-brand" /> alle Ordner
            </label>
            <button className="btn-secondary" aria-label="Suchen">
              <Search className="size-4" /> Suchen
            </button>
            {q && (
              <Link href={link(unread ? { filter: "ungelesen" } : {})} className="text-sm font-medium text-brand">
                Suche löschen
              </Link>
            )}
          </form>

          {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-bad">{error}</div>}

          {data && (
            <MailList
              key={JSON.stringify(query)}
              initial={data.mails}
              next={data.next}
              query={query}
              total={data.total}
              hits={data.hits}
              folderName={data.folderName}
              showFolderHint={Boolean(search && !all && data.mails.length === 0)}
            />
          )}
        </>
      )}
    </main>
  );
}
