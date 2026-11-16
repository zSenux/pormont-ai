import Link from "next/link";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { customerName, isOverdue, openCentsOf, statusText } from "@/lib/buchhaltung/docs";
import { fmtEuroCents, lineNetCents, readLines } from "@/lib/buchhaltung/money";
import { artCode } from "@/lib/buchhaltung/belegliste";
import { TONE } from "@/lib/buchhaltung/ui";
import { KundenTabelle, KundenAktionen } from "./liste";

export const metadata = { title: "Kunden" };
export const dynamic = "force-dynamic";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const TABS = [["details", "Details"], ["auftraege", "Aufträge"], ["artikel", "Artikelbezug"], ["umsatz", "Umsatz"], ["kontakt", "Kontaktpersonen"]] as const;
type Tab = (typeof TABS)[number][0];
const LIMIT = 1000;

/** Kundenliste im Aufbau der Lexware-Kundenliste: A–Z oben, Tabelle, Detailbereich mit Reitern, rechts die Aktionen */
export default async function KundenPage({ searchParams }: { searchParams: Promise<{ q?: string; b?: string; k?: string; tab?: string; archiv?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const b = sp.b === "#" || (sp.b && LETTERS.includes(sp.b)) ? sp.b : "";
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "details";
  const archiv = sp.archiv === "1";

  const where: Prisma.CustomerWhereInput = { archived: archiv };
  const and: Prisma.CustomerWhereInput[] = [];
  if (b === "#") and.push({ NOT: LETTERS.map((l) => ({ name: { startsWith: l, mode: "insensitive" as const } })) });
  else if (b) and.push({ name: { startsWith: b, mode: "insensitive" } });
  if (q) {
    const n = /^\d{1,9}$/.test(q) ? Number(q) : null;
    and.push({
      OR: [
        ...q.split(/\s+/).filter(Boolean).map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
        { contactName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { street: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { zip: { startsWith: q } },
        { email: { contains: q, mode: "insensitive" } },
        ...(n ? [{ number: n }] : []),
      ],
    });
  }
  if (and.length) where.AND = and;

  const [list, count] = await Promise.all([
    db.customer.findMany({ where, orderBy: [{ name: "asc" }], take: LIMIT, select: { id: true, number: true, kind: true, name: true, firstName: true, lastName: true, contactName: true, street: true, zip: true, city: true } }),
    db.customer.count({ where }),
  ]);
  const open = await db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN", customerId: { in: list.map((c) => c.id) } }, select: { customerId: true, grossCents: true, prepaidCents: true, paidCents: true } });
  const openBy = new Map<string, number>();
  for (const d of open) openBy.set(d.customerId!, (openBy.get(d.customerId!) ?? 0) + openCentsOf(d));

  const selId = list.some((c) => c.id === sp.k) ? sp.k! : list[0]?.id ?? null;
  const sel = selId ? await loadSel(selId) : null;

  const qs = (o: Partial<Record<"b" | "k" | "tab" | "q" | "archiv", string>>) => {
    const v = { q, b, k: selId ?? "", tab, archiv: archiv ? "1" : "", ...o };
    const s = new URLSearchParams();
    for (const [key, val] of Object.entries(v)) if (val && !(key === "tab" && val === "details")) s.set(key, val);
    const str = s.toString();
    return `/buchhaltung/kunden${str ? `?${str}` : ""}`;
  };

  const rows = list.map((c) => ({
    id: c.id,
    number: c.number,
    matchcode: c.name,
    ...nameParts(c),
    street: c.street ?? "",
    place: [c.zip, c.city].filter(Boolean).join(" "),
    open: openBy.get(c.id) ?? 0,
    href: qs({ k: c.id }),
  }));

  return (
    <main data-wide className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-auto">Kunden{archiv ? " · Archiv" : ""}</h1>
        <Link href={qs({ archiv: archiv ? "" : "1", k: "" })} className="text-sm text-steel hover:text-brand">{archiv ? "Aktive Kunden" : "Archivierte Kunden"}</Link>
      </div>
      <form className="flex gap-2" action="/buchhaltung/kunden">
        {b && <input type="hidden" name="b" value={b} />}
        {archiv && <input type="hidden" name="archiv" value="1" />}
        <input name="q" defaultValue={q} placeholder="Name, Kd-Nr., Straße, PLZ, Ort oder E-Mail …" className="input min-w-0 flex-1" aria-label="Kunden suchen" />
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>
      <nav className="flex flex-wrap gap-0.5" aria-label="Anfangsbuchstabe">
        {[["", "Alle"], ...LETTERS.map((l) => [l, l]), ["#", "#"]].map(([k, l]) => (
          <Link key={l} href={qs({ b: k, k: "" })} className={clsx("min-w-7 rounded px-1.5 py-0.5 text-center text-xs font-semibold", k === b ? "bg-brand text-white" : "bg-white text-steel hover:bg-brand-soft hover:text-brand")}>{l}</Link>
        ))}
      </nav>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13.5rem]">
        <div className="min-w-0 space-y-3">
          <KundenTabelle rows={rows} selId={selId} />
          <p className="text-sm text-steel">{count} {count === 1 ? "Kunde" : "Kunden"}{count > LIMIT ? ` · angezeigt die ersten ${LIMIT}, bitte Buchstaben oder Suche nutzen` : ""}</p>

          {sel && (
            <section className="card p-0">
              <div className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2" role="tablist">
                {TABS.map(([k, l]) => (
                  <Link key={k} href={qs({ tab: k })} scroll={false} role="tab" aria-selected={k === tab} className={clsx("shrink-0 rounded-t-md px-3 py-1.5 text-sm font-medium", k === tab ? "bg-brand text-white" : "text-steel hover:text-ink")}>{l}</Link>
                ))}
              </div>
              <div className="p-4 text-sm">
                <Detail tab={tab} c={sel} />
              </div>
            </section>
          )}
        </div>
        <KundenAktionen
          sel={sel ? { id: sel.id, name: sel.name, address: [sel.street, [sel.zip, sel.city].filter(Boolean).join(" "), sel.country !== "DE" ? sel.country : null].filter(Boolean).join(", "), vatId: sel.vatId, orderId: sel.orders[0]?.id ?? null, orderNo: sel.orders[0]?.number ?? null } : null}
          exportHref={`/api/buchhaltung/kunden?${new URLSearchParams({ ...(q ? { q } : {}), ...(b ? { b } : {}), ...(archiv ? { archiv: "1" } : {}) })}`}
        />
      </div>
    </main>
  );
}

/** Name/Vorname wie in Lexware: bei Personen aus den Feldern, bei Firmen aus dem Ansprechpartner (ohne Herr/Frau/Dr.) */
function nameParts(c: { kind: string; firstName: string | null; lastName: string | null; contactName: string | null }) {
  if (c.kind === "PERSON") return { lastName: c.lastName ?? "", firstName: c.firstName ?? "" };
  const w = (c.contactName ?? "").split(/\s+/).filter((x) => x && !/^(herr|frau|hr\.?|fr\.?|dr\.?|prof\.?|dipl\.-?\w*)$/i.test(x));
  return { lastName: w.slice(-1)[0] ?? "", firstName: w.slice(0, -1).join(" ") };
}

type Sel = NonNullable<Awaited<ReturnType<typeof loadSel>>>;
async function loadSel(id: string) {
  return db.customer.findUnique({ where: { id }, include: { docs: { orderBy: { date: "desc" }, take: 500 }, orders: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, number: true } } } });
}

function Field({ l, v }: { l: string; v?: string | number | null }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-0.5">
      <dt className="text-steel">{l}:</dt>
      <dd className="[overflow-wrap:anywhere]">{v || "–"}</dd>
    </div>
  );
}

function Detail({ tab, c }: { tab: Tab; c: Sel }) {
  // Wie in der Auswertung: stornierte Rechnungen zählen, ihre Storno-Gutschrift wird abgezogen
  const invoices = c.docs.filter((d) => (d.kind === "RECHNUNG" || d.kind === "GUTSCHRIFT") && d.status !== "ENTWURF");
  if (tab === "details") {
    const addr = [c.name, c.kind === "FIRMA" && c.contactName ? `z. Hd. ${c.contactName}` : null, c.street, [c.zip, c.city].filter(Boolean).join(" "), c.country !== "DE" ? c.country : "Deutschland"].filter(Boolean);
    return (
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <dl>
          <Field l="Kd-Nr." v={c.number} />
          <Field l="Anrede" v={c.salutation} />
          <Field l={c.kind === "FIRMA" ? "Firma" : "Name"} v={c.name} />
          {c.kind === "PERSON" && <Field l="Vorname / Name" v={[c.firstName, c.lastName].filter(Boolean).join(" ")} />}
          {c.kind === "FIRMA" && <Field l="Ansprechpartner" v={c.contactName} />}
          <Field l="Straße" v={c.street} />
          <Field l="PLZ, Ort" v={[c.zip, c.city].filter(Boolean).join(" ")} />
          <Field l="Land" v={c.country} />
          <Field l="Telefon" v={c.phone} />
          <Field l="E-Mail" v={c.email} />
          <Field l="USt-IdNr." v={c.vatId} />
          <Field l="Zahlungsziel" v={c.paymentDays ? `${c.paymentDays} Tage` : "Standard"} />
          {c.notes && <Field l="Notiz" v={c.notes} />}
          {c.lexId && <p className="mt-2 text-xs text-steel">Aus Lexware übernommen.</p>}
        </dl>
        <div className="min-w-56 rounded-lg border border-line p-3">
          <p className="mb-1 text-xs font-semibold text-steel uppercase">Rechnungs- und Lieferanschrift</p>
          {addr.map((l, i) => <p key={i} className={i === 0 ? "font-semibold" : ""}>{l}</p>)}
          <Link href={`/buchhaltung/kunden/${c.id}`} className="mt-2 inline-block text-xs font-medium text-brand">Kundenakte öffnen →</Link>
        </div>
      </div>
    );
  }
  if (tab === "auftraege") {
    if (!c.docs.length) return <p className="text-steel">Noch keine Angebote oder Rechnungen.</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-[13px] tabular-nums">
          <thead><tr className="text-left text-xs text-steel"><th className="py-1 pr-2">Datum</th><th className="pr-2">Art</th><th className="pr-2">Belegnr.</th><th className="pr-2">Notiz</th><th className="pr-2">Status</th><th className="text-right">Gesamt</th></tr></thead>
          <tbody>
            {c.docs.slice(0, 100).map((d) => (
              <tr key={d.id} className="border-t border-line/60">
                <td className="py-1 pr-2 whitespace-nowrap">{formatDate(d.date)}</td>
                <td className="pr-2 font-semibold">{artCode(d).code}</td>
                <td className="pr-2 whitespace-nowrap"><Link href={`/buchhaltung/beleg/${d.id}`} className="font-medium text-brand">{d.number ?? "Entwurf"}</Link>{d.imported && <span className="ml-1 rounded bg-mist px-1 text-[10px] text-steel">LX</span>}</td>
                <td className="max-w-[14rem] truncate pr-2">{d.title ?? ""}</td>
                <td className="pr-2"><span className={clsx("chip px-1.5 py-0 text-[11px]", isOverdue(d) ? TONE.UEBERFAELLIG : TONE[d.status])}>{statusText(d)}</span></td>
                <td className="text-right whitespace-nowrap">{fmtEuroCents((d.kind === "GUTSCHRIFT" ? -1 : 1) * d.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link href={`/buchhaltung/belege?art=alle&jahr=alle&q=${encodeURIComponent(c.number ? String(c.number) : c.name)}`} className="mt-2 inline-block text-xs font-medium text-brand">In der Belegliste zeigen →</Link>
      </div>
    );
  }
  if (tab === "artikel") {
    const by = new Map<string, { name: string; unit: string; qty: number; net: number; n: number }>();
    for (const d of invoices) {
      if (d.kind !== "RECHNUNG" || d.status === "STORNIERT") continue;
      for (const l of readLines(d.lines)) {
        const key = `${l.articleId ?? l.name.toLowerCase()}|${l.unit}`;
        const e = by.get(key) ?? { name: l.name, unit: l.unit, qty: 0, net: 0, n: 0 };
        e.qty += l.qty;
        e.net += lineNetCents(l);
        e.n += 1;
        by.set(key, e);
      }
    }
    const top = [...by.values()].sort((a, b) => b.net - a.net).slice(0, 30);
    if (!top.length) return <p className="text-steel">Noch keine berechneten Positionen.</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-[13px] tabular-nums">
          <thead><tr className="text-left text-xs text-steel"><th className="py-1 pr-2">Artikel / Leistung</th><th className="pr-2 text-right">Menge</th><th className="pr-2 text-right">Rechnungen</th><th className="text-right">Netto</th></tr></thead>
          <tbody>
            {top.map((a, i) => (
              <tr key={i} className="border-t border-line/60"><td className="max-w-[20rem] truncate py-1 pr-2">{a.name}</td><td className="pr-2 text-right whitespace-nowrap">{a.qty.toLocaleString("de-DE", { maximumFractionDigits: 2 })} {a.unit}</td><td className="pr-2 text-right">{a.n}</td><td className="text-right whitespace-nowrap">{fmtEuroCents(a.net)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-steel">Aus Lexware übernommene Rechnungen haben nur eine Pauschal-Position.</p>
      </div>
    );
  }
  if (tab === "umsatz") {
    const years = new Map<number, { net: number; gross: number; open: number; n: number }>();
    for (const d of invoices) {
      const y = +d.date.toISOString().slice(0, 4);
      const e = years.get(y) ?? { net: 0, gross: 0, open: 0, n: 0 };
      const sign = d.kind === "GUTSCHRIFT" ? -1 : 1;
      // Schlussrechnung zählt nur mit dem Rest (Abschläge sind schon gezählt)
      e.net += sign * (d.netCents - d.prepaidNet);
      e.gross += sign * (d.grossCents - d.prepaidCents);
      if (d.kind === "RECHNUNG" && d.status === "OFFEN") e.open += openCentsOf(d);
      e.n += d.kind === "RECHNUNG" && d.status !== "STORNIERT" ? 1 : 0;
      years.set(y, e);
    }
    const list = [...years.entries()].sort((a, b) => b[0] - a[0]);
    if (!list.length) return <p className="text-steel">Noch kein Umsatz.</p>;
    const total = list.reduce((s, [, v]) => s + v.net, 0);
    return (
      <table className="w-full max-w-xl text-[13px] tabular-nums">
        <thead><tr className="text-left text-xs text-steel"><th className="py-1">Jahr</th><th className="text-right">Rechnungen</th><th className="text-right">Umsatz netto</th><th className="text-right">brutto</th><th className="text-right">offen</th></tr></thead>
        <tbody>
          {list.map(([y, v]) => (
            <tr key={y} className="border-t border-line/60"><td className="py-1 font-semibold">{y}</td><td className="text-right">{v.n}</td><td className="text-right">{fmtEuroCents(v.net)}</td><td className="text-right">{fmtEuroCents(v.gross)}</td><td className={clsx("text-right", v.open && "text-warn")}>{fmtEuroCents(v.open)}</td></tr>
          ))}
          <tr className="border-t-2 border-line font-semibold"><td className="py-1">Gesamt</td><td /><td className="text-right">{fmtEuroCents(total)}</td><td /><td /></tr>
        </tbody>
      </table>
    );
  }
  // Kontaktpersonen
  return (
    <dl>
      {c.kind === "FIRMA" ? <Field l="Ansprechpartner" v={c.contactName} /> : <Field l="Person" v={customerName({ address: {}, customer: c })} />}
      <Field l="Telefon" v={c.phone} />
      <Field l="E-Mail" v={c.email} />
      <p className="mt-2 text-xs text-steel">Weitere Ansprechpartner und Gesprächsnotizen stehen in der <Link href={`/buchhaltung/kunden/${c.id}`} className="font-medium text-brand">Kundenakte</Link>.</p>
    </dl>
  );
}
