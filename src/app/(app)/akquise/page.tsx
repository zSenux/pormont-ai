import Link from "next/link";
import { CalendarClock, Phone, Scale, Search, UserPlus } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinDateTime, formatDate, formatEuro, todayYmd } from "@/lib/berlin";
import { STAGES, STAGE_LABEL, STAGE_TONE, type StageKey } from "@/lib/akquise/stages";
import { NewLeadForm, SearchForm } from "./forms";

export const metadata = { title: "Akquise" };
export const dynamic = "force-dynamic";

export default async function AkquisePage({ searchParams }: { searchParams: Promise<{ stufe?: string; q?: string; neu?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stufe as StageKey) ? (sp.stufe as StageKey) : null;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const open = { stage: { notIn: ["GEWONNEN", "VERLOREN"] as StageKey[] } };
  const where = {
    ...(stage ? { stage } : open),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { city: { contains: q, mode: "insensitive" as const } }, { category: { contains: q, mode: "insensitive" as const } }, { contactName: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const tomorrow = berlinDateTime(addDaysYmd(todayYmd(), 1));
  const [leads, counts, due] = await Promise.all([
    db.lead.findMany({ where, orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }], take: 200 }),
    db.lead.groupBy({ by: ["stage"], _count: true, _sum: { value: true } }),
    db.lead.findMany({ where: { ...open, nextFollowUpAt: { lt: tomorrow } }, orderBy: { nextFollowUpAt: "asc" }, take: 10 }),
  ]);
  const count = new Map(counts.map((c) => [c.stage, c]));
  const pipeline = counts.filter((c) => c.stage === "ANGEBOT" || c.stage === "TERMIN").reduce((s, c) => s + (c._sum.value ?? 0), 0);
  const won = count.get("GEWONNEN")?._sum.value ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Neukunden-Akquise</h1>
        <p className="mt-1 text-sm text-steel">Bauunternehmen, Architekten, Hausverwaltungen und Industrie in der Region finden, anrufen, nachfassen.</p>
      </div>

      {sp.neu && <p className="card border-ok/30 bg-emerald-50 p-3 text-sm text-ok">{sp.neu} neue Interessenten übernommen.</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-steel">Offen</p><p className="text-2xl font-semibold">{(["NEU", "KONTAKTIERT", "TERMIN", "ANGEBOT"] as const).reduce((s, k) => s + (count.get(k)?._count ?? 0), 0)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Heute nachfassen</p><p className="text-2xl font-semibold text-brand">{due.length}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Termin + Angebot</p><p className="text-2xl font-semibold">{formatEuro(pipeline)}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Gewonnen</p><p className="text-2xl font-semibold text-ok">{formatEuro(won)}</p></div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          {due.length > 0 && (
            <section className="card p-4">
              <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-brand" /> Heute nachfassen</h2>
              <ul className="mt-2 divide-y divide-line">
                {due.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-2 text-sm">
                    <Link href={`/akquise/${l.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">{l.name}</Link>
                    <span className="shrink-0 text-xs text-steel">{formatDate(l.nextFollowUpAt)}</span>
                    {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="btn-secondary shrink-0 px-2 py-1" aria-label={`${l.name} anrufen`}><Phone className="size-4" /></a>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form className="flex gap-2" action="/akquise">
            {stage && <input type="hidden" name="stufe" value={stage} />}
            <input name="q" defaultValue={q} placeholder="Suchen: Firma, Ort, Branche …" className="input min-w-0 flex-1" aria-label="Suchen" />
            <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/akquise" className={clsx("chip px-3 py-1", !stage ? "border-brand bg-brand text-white" : "bg-white text-steel")}>Offen</Link>
            {STAGES.map((s) => (
              <Link key={s} href={`/akquise?stufe=${s}`} className={clsx("chip px-3 py-1", stage === s ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
                {STAGE_LABEL[s]} {count.get(s)?._count ?? 0}
              </Link>
            ))}
          </div>

          <ul className="space-y-2">
            {leads.length === 0 && <li className="card p-5 text-sm text-steel">Noch keine Interessenten. Rechts bei Google suchen oder von Hand anlegen.</li>}
            {leads.map((l) => (
              <li key={l.id}>
                <Link href={`/akquise/${l.id}`} className="card flex items-start gap-3 p-4 transition hover:border-brand">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name}</p>
                    <p className="truncate text-xs text-steel">{[l.category, l.city, l.contactName].filter(Boolean).join(" · ") || "–"}</p>
                    {l.nextFollowUpAt && <p className={clsx("mt-1 text-xs", l.nextFollowUpAt < tomorrow ? "font-medium text-brand" : "text-steel")}>Nachfassen {formatDate(l.nextFollowUpAt)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={clsx("chip px-2 py-0.5 text-[11px]", STAGE_TONE[l.stage])}>{STAGE_LABEL[l.stage]}</span>
                    {l.value ? <span className="text-xs text-steel">{formatEuro(l.value)}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="card space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Search className="size-4 text-brand" /> Neue Firmen finden</h2>
            <SearchForm configured={Boolean(process.env.GOOGLE_PLACES_API_KEY)} />
          </section>
          <details className="card p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold"><UserPlus className="size-4 text-brand" /> Von Hand anlegen</summary>
            <div className="mt-3"><NewLeadForm /></div>
          </details>
          <section className="card space-y-2 p-4 text-sm text-steel">
            <h2 className="flex items-center gap-2 font-semibold text-ink"><Scale className="size-4 text-brand" /> Rechtlich</h2>
            <p>Werbe-E-Mails an Firmen nur mit Einwilligung (§ 7 UWG). Erlaubt sind Anrufe bei Firmen mit mutmaßlichem Interesse und Briefe – dafür schreibt Jarvis Gesprächsleitfaden und Brief.</p>
            <p>Gespeichert werden nur geschäftliche Kontaktdaten. Wer keinen Kontakt will: auf „Verloren“ setzen oder löschen.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
