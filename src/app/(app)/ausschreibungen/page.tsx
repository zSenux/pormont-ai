import Link from "next/link";
import { ExternalLink, Plus, RefreshCw, Settings2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { CPV_LABEL, lastRefresh, tenderConfig, TENDER_STATUS_LABEL, TENDER_STATUSES, type TenderStatus } from "@/lib/ausschreibungen";
import { fetchTendersNow, newManualTender, saveTenderSettings } from "@/app/actions/ausschreibungen";
import { StateForm } from "@/components/state-form";

export const metadata = { title: "Ausschreibungen" };
export const dynamic = "force-dynamic";

const TONE: Record<TenderStatus, string> = { NEU: "border-brand/20 bg-brand-soft text-brand", INTERESSANT: "border-amber-200 bg-amber-50 text-warn", ANGEBOT: "border-emerald-200 bg-emerald-50 text-ok", ABGELEHNT: "border-line bg-mist text-steel" };
const scoreTone = (s: number) => (s >= 70 ? "bg-ok" : s >= 40 ? "bg-warn" : "bg-steel/50");

export default async function Ausschreibungen({ searchParams }: { searchParams: Promise<{ status?: string; alle?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = TENDER_STATUSES.includes(sp.status as TenderStatus) ? (sp.status as TenderStatus) : null;
  const showOld = sp.alle === "1";
  const [list, cfg, last, counts] = await Promise.all([
    db.tender.findMany({
      where: { ...(status ? { status } : { status: { not: "ABGELEHNT" } }), ...(showOld ? {} : { OR: [{ deadline: null }, { deadline: { gte: new Date() } }] }) },
      orderBy: [{ score: "desc" }, { deadline: { sort: "asc", nulls: "last" } }],
      take: 200,
    }),
    tenderConfig(),
    lastRefresh(),
    db.tender.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: TenderStatus) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Ausschreibungen</h1>
          <p className="mt-1 text-sm text-steel">Jarvis sucht jeden Werktag um 6 Uhr öffentliche Metallbau-Ausschreibungen rund um Mannheim (EU-Amtsblatt TED{cfg.rss.length ? ` + ${cfg.rss.length} Feeds` : ""}) und bewertet, wie gut sie zu ProMont passen.</p>
          <p className="mt-1 text-xs text-steel">{last ? `Zuletzt geprüft ${formatDateTime(last.at)}: ${last.found} Bekanntmachungen, ${last.fresh} neu passend.${last.errors.length ? ` ⚠️ ${last.errors.join(" · ")}` : ""}` : "Noch nicht abgerufen."}</p>
        </div>
        <StateForm action={fetchTendersNow} className="flex flex-col items-end gap-1" submit={<><RefreshCw className="size-4" /> Jetzt suchen</>}><span /></StateForm>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/ausschreibungen" className={clsx("chip px-3 py-1", !status ? "border-brand bg-brand text-white" : "bg-white text-steel")}>Offen</Link>
        {TENDER_STATUSES.map((s) => (
          <Link key={s} href={`/ausschreibungen?status=${s}`} className={clsx("chip px-3 py-1", status === s ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{TENDER_STATUS_LABEL[s]} ({count(s)})</Link>
        ))}
        <Link href={`/ausschreibungen?${status ? `status=${status}&` : ""}alle=${showOld ? "0" : "1"}`} className="chip bg-white px-3 py-1 text-steel">{showOld ? "Abgelaufene ausblenden" : "Auch abgelaufene"}</Link>
      </div>

      <section className="card divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-steel">Gerade keine passenden Ausschreibungen. Jarvis meldet sich per Push, sobald etwas Neues kommt.</p>}
        {list.map((t) => {
          const days = t.deadline ? Math.ceil((t.deadline.getTime() - Date.now()) / 86400_000) : null;
          return (
            <div key={t.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="flex w-12 shrink-0 flex-col items-center gap-1">
                <span className={clsx("grid size-11 place-items-center rounded-full text-sm font-bold text-white", scoreTone(t.score))}>{t.score}</span>
                <span className="text-[10px] text-steel">Passung</span>
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/ausschreibungen/${t.id}`} className="font-medium hover:text-brand">{t.title}</Link>
                <p className="text-xs text-steel">{[t.buyer, [t.postalCode, t.place].filter(Boolean).join(" "), t.source === "TED" ? "EU-Amtsblatt (TED)" : t.source === "RSS" ? "Feed" : "von Hand", t.publishedAt && `veröffentlicht ${formatDate(t.publishedAt)}`].filter(Boolean).join(" · ")}</p>
                {t.matched && <p className="mt-0.5 text-xs text-brand">Treffer: {t.matched}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <span className={clsx("chip", TONE[t.status as TenderStatus])}>{TENDER_STATUS_LABEL[t.status as TenderStatus]}</span>
                {t.deadline && <span className={clsx("text-xs", days !== null && days < 0 ? "text-steel line-through" : days !== null && days <= 7 ? "font-semibold text-bad" : "text-steel")}>Frist {formatDate(t.deadline)}{days !== null && days >= 0 ? ` · ${days} T.` : ""}</span>}
                {t.url && <a href={t.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-xs text-brand">Bekanntmachung <ExternalLink className="size-3" /></a>}
              </div>
            </div>
          );
        })}
      </section>

      <details className="card p-5">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Ausschreibung von Hand erfassen</summary>
        <p className="mt-1 text-xs text-steel">Z. B. aus einem Newsletter, vom Architekten oder einer Vergabeplattform.</p>
        <StateForm action={newManualTender} reset className="mt-3 grid gap-2 sm:grid-cols-2" submit="Erfassen">
          <input name="title" required minLength={5} placeholder="Titel, z. B. „Erneuerung Geländer Fußgängerbrücke“" className="input sm:col-span-2" aria-label="Titel" />
          <input name="buyer" placeholder="Auftraggeber" className="input" aria-label="Auftraggeber" />
          <div className="flex gap-2"><input name="postalCode" inputMode="numeric" pattern="\d{5}" placeholder="PLZ" className="input w-24" aria-label="PLZ" /><input name="place" placeholder="Ort" className="input" aria-label="Ort" /></div>
          <input name="url" type="url" placeholder="Link zur Bekanntmachung" className="input" aria-label="Link" />
          <label className="text-xs text-steel">Angebotsfrist<input name="deadline" type="date" className="input mt-1" /></label>
          <textarea name="description" rows={2} placeholder="Kurzbeschreibung" className="input sm:col-span-2" aria-label="Beschreibung" />
        </StateForm>
      </details>

      {me.role === "ADMIN" && (
        <details className="card p-5">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Settings2 className="size-4 text-brand" /> Suche einstellen</summary>
          <StateForm action={saveTenderSettings} className="mt-3 grid gap-3 sm:grid-cols-2" submit="Speichern">
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="ted" defaultChecked={cfg.ted} className="size-4 accent-brand" /> EU-Amtsblatt (TED) durchsuchen – Bauaufträge in Deutschland mit diesen CPV-Codes</label>
            <label className="text-xs font-semibold text-steel">CPV-Codes (je Zeile)<textarea name="cpv" rows={6} defaultValue={cfg.cpv.join("\n")} className="input mt-1 font-mono font-normal" /><span className="font-normal">{cfg.cpv.map((c) => CPV_LABEL[c]).filter(Boolean).join(", ")}</span></label>
            <label className="text-xs font-semibold text-steel">Stichwörter (je Zeile)<textarea name="keywords" rows={6} defaultValue={cfg.keywords.join("\n")} className="input mt-1 font-normal" /></label>
            <label className="text-xs font-semibold text-steel">PLZ-Bereiche (Anfang, je Zeile)<textarea name="plz" rows={3} defaultValue={cfg.plz.join("\n")} className="input mt-1 font-normal" /></label>
            <label className="text-xs font-semibold text-steel">RSS-Feeds (je Zeile)<textarea name="rss" rows={3} defaultValue={cfg.rss.join("\n")} placeholder="https://www.service.bund.de/… (Suche → RSS-Feed)" className="input mt-1 font-normal" /><span className="font-normal">Auf service.bund.de suchen (z. B. „Metallbau“, PLZ-Gebiet) und den RSS-Link der Ergebnisliste hier eintragen.</span></label>
            <label className="text-xs font-semibold text-steel">Push ab Passung (%)<input name="minScore" type="number" min={0} max={100} defaultValue={cfg.minScore} className="input mt-1 font-normal" /></label>
            <label className="text-xs font-semibold text-steel">Rückblick (Tage)<input name="days" type="number" min={1} max={60} defaultValue={cfg.days} className="input mt-1 font-normal" /></label>
          </StateForm>
        </details>
      )}
    </main>
  );
}
