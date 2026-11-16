import Link from "next/link";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { todayYmd } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { ARTEN, LIST_LIMIT, loadList, readParams, type ListParams } from "@/lib/buchhaltung/belegliste";
import { BelegTabelle } from "./liste";

export const metadata = { title: "Belege" };
export const dynamic = "force-dynamic";

/** Belegliste im Aufbau der Lexware-Auftragsliste: Jahr oben, kompakte Tabelle, rechts die Aktionen */
export default async function BelegeListe({ searchParams }: { searchParams: Promise<ListParams> }) {
  await requireUser();
  const p = readParams(await searchParams);
  const { art, conf, status, q, herkunft, jahr } = p;
  const { rows, count, firstYear } = await loadList(p);

  const qs = (o: Partial<Record<"art" | "status" | "herkunft" | "jahr", string>>) => {
    const v = { art, status, herkunft, jahr, ...o };
    const s = new URLSearchParams({ art: v.art });
    if (v.status !== "alle" && !o.art) s.set("status", v.status);
    if (v.herkunft !== "alle") s.set("herkunft", v.herkunft);
    if (v.jahr !== todayYmd().slice(0, 4)) s.set("jahr", v.jahr);
    if (q) s.set("q", q);
    return s.toString();
  };
  const href = (o: Parameters<typeof qs>[0]) => `/buchhaltung/belege?${qs(o)}`;
  const thisYear = +todayYmd().slice(0, 4);
  const years = Array.from({ length: Math.max(1, thisYear - Math.min(firstYear, thisYear) + 1) }, (_, i) => String(thisYear - i));

  const sum = rows.reduce((s, r) => ({ gross: s.gross + r.gross, prepaid: s.prepaid + r.prepaid, claim: s.claim + r.claim, open: s.open + r.open }), { gross: 0, prepaid: 0, claim: 0, open: 0 });
  const chip = (on: boolean, soft = false) => clsx("chip px-3 py-1", on ? (soft ? "border-brand bg-brand-soft text-brand" : "border-brand bg-brand text-white") : "border-line bg-white text-steel hover:text-ink");

  return (
    <main data-wide className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="page-title mr-auto">
          {conf.label} <span className="text-steel">·</span>{" "}
          <span className="font-normal text-steel">{jahr === "alle" ? "alle Jahre" : `Jahr ${jahr}`}</span>
        </h1>
        <nav className="flex flex-wrap gap-1" aria-label="Jahr">
          {years.slice(0, 6).map((y) => <Link key={y} href={href({ jahr: y })} className={chip(y === jahr, true)}>{y}</Link>)}
          <Link href={href({ jahr: "alle" })} className={chip(jahr === "alle", true)}>Alle</Link>
        </nav>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ARTEN) as (keyof typeof ARTEN)[]).map((k) => (
          <Link key={k} href={href({ art: k, status: "alle" })} className={chip(k === art)}>{k === "alle" ? "Alle Belege" : ARTEN[k].label}</Link>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-line sm:block" aria-hidden />
        {[["alle", "Alle Quellen"], ["jarvis", "Jarvis"], ["lexware", "Lexware"]].map(([k, l]) => (
          <Link key={k} href={href({ herkunft: k })} className={chip(k === herkunft, true)}>{l}</Link>
        ))}
      </div>
      {conf.status.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {conf.status.map(([k, l]) => (
            <Link key={k} href={href({ status: k })} className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", k === status ? "bg-ink text-white" : "bg-white text-steel hover:text-ink")}>{l}</Link>
          ))}
        </div>
      )}

      <form className="flex gap-2" action="/buchhaltung/belege">
        <input type="hidden" name="art" value={art} />
        {status !== "alle" && <input type="hidden" name="status" value={status} />}
        {herkunft !== "alle" && <input type="hidden" name="herkunft" value={herkunft} />}
        <input type="hidden" name="jahr" value={jahr} />
        <input name="q" defaultValue={q} placeholder="Belegnr., Kunde, Kd-Nr. oder Notiz …" className="input min-w-0 flex-1" aria-label="Suchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>

      {conf.kinds.length === 1 && conf.kinds[0] === "GUTSCHRIFT" && <p className="text-sm text-steel">Gutschriften entstehen beim Stornieren einer Rechnung (Rechnung markieren → „Beleg öffnen“ → „Stornieren“).</p>}

      <BelegTabelle rows={rows} exportHref={`/api/buchhaltung/belegliste?${qs({})}`} />

      <p className="text-sm text-steel">
        {count} {count === 1 ? "Beleg" : "Belege"} gefunden · Gesamt {fmtEuroCents(sum.gross)}
        {sum.prepaid ? ` · Abschläge ${fmtEuroCents(sum.prepaid)}` : ""} · Forderung {fmtEuroCents(sum.claim)}
        {sum.open ? ` · davon offen ${fmtEuroCents(sum.open)}` : ""}
        {count > LIST_LIMIT ? ` · angezeigt die neuesten ${LIST_LIMIT}, bitte Jahr oder Suche eingrenzen` : ""}
      </p>
    </main>
  );
}
