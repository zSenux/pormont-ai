import Link from "next/link";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
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
  const kinds = [...conf.kinds] as string[];
  const [{ rows, count }, perYear, pending] = await Promise.all([
    loadList(p),
    // Belege je Jahr (für die Jahres-Auswahl mit Anzahl; Lexware-Belege liegen oft in früheren Jahren)
    db.$queryRaw<{ y: number; n: number }[]>`
      SELECT EXTRACT(YEAR FROM "date" AT TIME ZONE 'Europe/Berlin')::int AS y, COUNT(*)::int AS n
      FROM "SalesDoc" WHERE "kind"::text = ANY(${kinds}) ${herkunft === "alle" ? Prisma.empty : Prisma.sql`AND "imported" = ${herkunft === "lexware"}`}
      GROUP BY 1 ORDER BY 1 DESC`,
    // Alte Rechnungen, die in der Datenübernahme liegen, aber noch nicht in die Buchhaltung übernommen wurden
    db.erpRecord.count({ where: { kind: "rechnung", lexId: null, amount: { not: null } } }),
  ]);

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
  const yearCount = new Map(perYear.map((r) => [String(r.y), r.n]));
  const years = [...new Set([String(thisYear), ...perYear.map((r) => String(r.y))])].sort((a, b) => +b - +a);
  const otherYears = years.filter((y) => y !== jahr && yearCount.get(y));

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
          {years.slice(0, 8).map((y) => <Link key={y} href={href({ jahr: y })} className={chip(y === jahr, true)}>{y}{yearCount.get(y) ? <span className="ml-1 text-xs opacity-70">{yearCount.get(y)}</span> : null}</Link>)}
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

      {pending > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-warn">
          {pending} alte Rechnungen aus Lexware liegen noch in der Datenübernahme und stehen deshalb hier noch nicht.{" "}
          <Link href="/datenuebernahme" className="font-semibold underline">Dort „In die Buchhaltung übernehmen“ klicken</Link> (nur Admin).
        </p>
      )}
      {rows.length === 0 && jahr !== "alle" && otherYears.length > 0 && (
        <p className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-steel">
          In {jahr} gibt es hier keine Belege. Belege gibt es in{" "}
          {otherYears.slice(0, 6).map((y, i) => <span key={y}>{i ? ", " : ""}<Link href={href({ jahr: y })} className="font-semibold text-brand">{y}</Link> ({yearCount.get(y)})</span>)}
          {" "}oder <Link href={href({ jahr: "alle" })} className="font-semibold text-brand">alle Jahre</Link>.
        </p>
      )}
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
