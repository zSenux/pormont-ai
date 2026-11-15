import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, Workflow } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { canArea, type RightsUser } from "@/lib/rights-shared";
import { formatDate } from "@/lib/berlin";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { customerName, isOverdue, openCentsOf } from "@/lib/buchhaltung/docs";
import { lowStock } from "@/lib/stock";
import { newDocAction } from "@/app/actions/buchhaltung";
import { AblaufTile, type MenuEntry, type TileStat } from "./tile";
import type { AblaufIcon } from "./icons";

// Arbeitsablauf als Startbild: Verkauf (Kunde → Angebot → Auftragsbestätigung → Lieferschein → Rechnung),
// Stammdaten (Artikel, Lager) und Einkauf (Lieferant → Bestellung → Wareneingang buchen).
// Jede Kachel zeigt den Stand live und öffnet per Klick ihr Menü. Kacheln ohne Recht fallen weg.

type Tile = { title: string; icon: AblaufIcon; badge?: number; stats: TileStat[]; menu: MenuEntry[]; step?: number };

const euro = (c: number) => fmtEuroCents(c).replace(/,00\s€$/, " €");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

async function salesTiles(): Promise<Record<"kunde" | "angebot" | "rechnung", Tile>> {
  const monthStart = new Date(Date.now() - 30 * 86400_000);
  const [customers, newCustomers, quotes, quoteDrafts, invoices, recentQuotes] = await Promise.all([
    db.customer.count({ where: { archived: false } }),
    db.customer.count({ where: { archived: false, createdAt: { gte: monthStart } } }),
    db.salesDoc.aggregate({ where: { kind: "ANGEBOT", status: "OFFEN" }, _sum: { netCents: true }, _count: true }),
    db.salesDoc.count({ where: { kind: { in: ["ANGEBOT", "RECHNUNG"] }, status: "ENTWURF" } }),
    db.salesDoc.findMany({
      where: { kind: "RECHNUNG", status: "OFFEN" },
      orderBy: { dueDate: "asc" },
      select: { id: true, number: true, kind: true, status: true, dueDate: true, grossCents: true, paidCents: true, prepaidCents: true, address: true, customer: { select: { name: true } } },
    }),
    db.salesDoc.findMany({ where: { kind: "ANGEBOT", status: { in: ["OFFEN", "ENTWURF"] } }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, number: true, title: true, netCents: true, address: true, customer: { select: { name: true } } } }),
  ]);
  const openCents = invoices.reduce((s, d) => s + openCentsOf(d), 0);
  const overdue = invoices.filter(isOverdue);
  return {
    kunde: {
      title: "Kunde",
      icon: "kunde",
      stats: [{ text: plural(customers, "Kunde", "Kunden") }, ...(newCustomers ? [{ text: `+${newCustomers} in 30 Tagen`, tone: "ok" as const }] : [])],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/buchhaltung/kunden", strong: true },
        { type: "search", label: "Kundenmappe öffnen", href: "/buchhaltung/kunden", placeholder: "Kundenmappe: Name, Ort, Nr. …" },
        { type: "link", label: "Kunde neu", href: "/buchhaltung/kunden/neu" },
      ],
    },
    angebot: {
      title: "Angebot",
      icon: "angebot",
      step: 1,
      badge: quotes._count,
      stats: [{ text: quotes._count ? `${quotes._count} offen · ${euro(quotes._sum.netCents ?? 0)}` : "keine offenen" }, ...(quoteDrafts ? [{ text: plural(quoteDrafts, "Entwurf", "Entwürfe") + " in Arbeit", tone: "muted" as const }] : [])],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/buchhaltung/belege?art=angebote", strong: true },
        { type: "action", label: "Angebot neu", action: newDocAction.bind(null, "ANGEBOT", {}) },
        { type: "link", label: "Angebot sprechen", href: "/buchhaltung/angebot-sprache", hint: "Diktat" },
        { type: "link", label: "Aus Vorlage mit 3D", href: "/buchhaltung/vorlagen", hint: "Geländer, Tor …" },
        { type: "recent", title: "Zuletzt bearbeitet", items: recentQuotes.map((d) => ({ label: `${d.number ?? "Entwurf"} · ${customerName(d) || "ohne Kunde"}`, sub: [d.title, euro(d.netCents) + " netto"].filter(Boolean).join(" · "), href: `/buchhaltung/beleg/${d.id}` })) },
      ],
    },
    rechnung: {
      title: "Rechnung",
      icon: "rechnung",
      step: 4,
      badge: invoices.length,
      stats: [
        { text: invoices.length ? `${invoices.length} offen · ${euro(openCents)}` : "alles bezahlt", tone: invoices.length ? undefined : "ok" },
        ...(overdue.length ? [{ text: `${overdue.length} überfällig`, tone: "bad" as const }] : []),
      ],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/buchhaltung/belege?art=rechnungen", strong: true },
        { type: "action", label: "Rechnung neu", action: newDocAction.bind(null, "RECHNUNG", {}) },
        { type: "link", label: "Offene Rechnungen", href: "/buchhaltung/belege?art=rechnungen&status=offen", hint: euro(openCents) },
        { type: "link", label: "Mahnwesen", href: "/buchhaltung/mahnwesen", hint: overdue.length ? `${overdue.length} überfällig` : undefined },
        { type: "recent", title: "Als Nächstes fällig", items: invoices.slice(0, 4).map((d) => ({ label: `${d.number} · ${customerName(d)}`, sub: `${euro(openCentsOf(d))} · fällig ${formatDate(d.dueDate)}`, href: `/buchhaltung/beleg/${d.id}` })) },
      ],
    },
  };
}

async function orderTiles(): Promise<Record<"ab" | "lieferschein", Tile>> {
  const open = await db.order.findMany({
    where: { status: { in: ["NEU", "IN_ARBEIT", "PAUSIERT"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, number: true, title: true, status: true, valueCents: true, dueDate: true, customer: { select: { name: true } } },
  });
  const value = open.reduce((s, o) => s + o.valueCents, 0);
  const fresh = open.filter((o) => o.status === "NEU").length;
  const recent = (doc: "bestaetigung" | "lieferschein") => open.slice(0, 5).map((o) => ({ label: `${o.number} · ${o.customer?.name ?? o.title}`, sub: o.title + (o.dueDate ? ` · bis ${formatDate(o.dueDate)}` : ""), href: `/auftraege/${o.id}/${doc}` }));
  return {
    ab: {
      title: "Auftragsbestätigung",
      icon: "ab",
      step: 2,
      badge: fresh,
      stats: [{ text: open.length ? `${open.length} Aufträge · ${euro(value)}` : "keine offenen Aufträge" }, ...(fresh ? [{ text: `${fresh} neu – noch bestätigen`, tone: "warn" as const }] : [])],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/auftraege", strong: true },
        { type: "link", label: "Angenommenes Angebot", href: "/buchhaltung/belege?art=angebote&status=offen", hint: "→ wird Auftrag" },
        { type: "recent", title: "Bestätigung drucken für", items: recent("bestaetigung"), empty: "Ein Auftrag entsteht, sobald ein Angebot angenommen wird." },
      ],
    },
    lieferschein: {
      title: "Lieferschein",
      icon: "lieferschein",
      step: 3,
      stats: [{ text: open.length ? `${plural(open.length, "Auftrag", "Aufträge")} lieferbar` : "nichts zu liefern" }, { text: "mit Unterschrift-Feld", tone: "muted" }],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/auftraege", strong: true },
        { type: "recent", title: "Lieferschein drucken für", items: recent("lieferschein"), empty: "Kein offener Auftrag." },
      ],
    },
  };
}

async function articleTile(): Promise<Tile> {
  const n = await db.article.count();
  return {
    title: "Artikel",
    icon: "artikel",
    stats: [{ text: plural(n, "Artikel", "Artikel") }],
    menu: [
      { type: "link", label: "Übersicht öffnen", href: "/buchhaltung/artikel", strong: true },
      { type: "search", label: "Artikel suchen", href: "/buchhaltung/artikel", placeholder: "Artikel suchen …" },
      { type: "link", label: "Stahl-Rechner", href: "/lieferanten/stahl", hint: "kg & €" },
    ],
  };
}

async function stockTile(): Promise<Tile> {
  const [n, low] = await Promise.all([db.stockItem.count(), lowStock(50)]);
  return {
    title: "Lager",
    icon: "lager",
    badge: low.length,
    stats: [{ text: plural(n, "Lagerartikel", "Lagerartikel") }, low.length ? { text: `${low.length} unter Mindestbestand`, tone: "warn" } : { text: "Bestand in Ordnung", tone: "ok" }],
    menu: [
      { type: "link", label: "Übersicht öffnen", href: "/lager", strong: true },
      { type: "recent", title: "Nachbestellen", items: low.slice(0, 5).map((i) => ({ label: i.name, sub: `Bestand ${i.quantity.toLocaleString("de-DE")} ${i.unit} · min. ${i.minQuantity?.toLocaleString("de-DE")}`, href: `/lager/${i.id}` })), empty: "Alles über Mindestbestand." },
    ],
  };
}

async function purchaseTiles(): Promise<Record<"lieferant" | "bestellung" | "eingang", Tile>> {
  const [suppliers, requests, open] = await Promise.all([
    db.supplier.count(),
    db.supplierRequest.count({ where: { status: { in: ["GESENDET", "ANGEBOT"] } } }),
    db.supplierOrder.findMany({ where: { status: { in: ["BESTELLT", "TEILGELIEFERT"] } }, orderBy: [{ expectedAt: "asc" }, { orderedAt: "asc" }], select: { id: true, number: true, status: true, totalNet: true, expectedAt: true, supplier: { select: { name: true } } } }),
  ]);
  const now = new Date();
  const late = open.filter((o) => o.expectedAt && o.expectedAt < now);
  const sum = Math.round(open.reduce((s, o) => s + o.totalNet, 0) * 100);
  return {
    lieferant: {
      title: "Lieferant",
      icon: "lieferant",
      stats: [{ text: plural(suppliers, "Lieferant", "Lieferanten") }, ...(requests ? [{ text: `${requests} Preisanfragen offen`, tone: "muted" as const }] : [])],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/lieferanten", strong: true },
        { type: "search", label: "Im Katalog suchen", href: "/lieferanten", placeholder: "Katalog: z. B. Flachstahl 50x8" },
        { type: "link", label: "Nachunternehmer", href: "/nachunternehmer" },
      ],
    },
    bestellung: {
      title: "Bestellung",
      icon: "bestellung",
      badge: open.length,
      stats: [{ text: open.length ? `${open.length} offen · ${euro(sum)}` : "keine offenen" }],
      menu: [
        { type: "link", label: "Übersicht öffnen", href: "/bestellungen", strong: true },
        { type: "link", label: "Bestellung neu", href: "/bestellungen?neu=1#neu" },
        { type: "link", label: "Gelieferte Bestellungen", href: "/bestellungen?status=GELIEFERT" },
      ],
    },
    eingang: {
      title: "Offene Bestellungen einbuchen",
      icon: "eingang",
      badge: late.length,
      stats: [{ text: open.length ? `${plural(open.length, "Lieferung", "Lieferungen")} erwartet` : "nichts erwartet" }, ...(late.length ? [{ text: `${late.length} überfällig`, tone: "bad" as const }] : [])],
      menu: [
        { type: "link", label: "Wareneingang öffnen", href: "/bestellungen", strong: true },
        { type: "recent", title: "Wareneingang buchen für", items: open.slice(0, 5).map((o) => ({ label: `${o.number} · ${o.supplier.name}`, sub: o.expectedAt ? `Liefertermin ${formatDate(o.expectedAt)}${o.expectedAt < now ? " – überfällig" : ""}` : "ohne Liefertermin", href: `/bestellungen/${o.id}` })), empty: "Keine offenen Bestellungen." },
      ],
    },
  };
}

/* ---------- Darstellung ---------- */

function Arrow({ dir, className }: { dir: "right" | "left" | "down"; className?: string }) {
  const Icon = dir === "down" ? ArrowDown : dir === "left" ? ArrowLeft : ArrowRight;
  return (
    <div className={clsx("relative flex items-center justify-center", className)} aria-hidden>
      <span className={clsx("absolute bg-white/35", dir === "down" ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2" : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2")} />
      <span className="relative grid size-6 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/40 backdrop-blur"><Icon className="size-3.5" /></span>
    </div>
  );
}

function Lane({ title, hint, children, className }: { title: string; hint: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("min-w-0", className)}>
      <header className="mb-3 flex items-baseline gap-2">
        <h3 className="text-xs font-bold tracking-[0.18em] text-sky-100 uppercase">{title}</h3>
        <span className="hidden truncate text-xs text-sky-200/80 sm:inline">{hint}</span>
      </header>
      {children}
    </section>
  );
}

const T = (t: Tile) => <AblaufTile {...t} />;

export async function AblaufBoard({ user, compact = false }: { user: RightsUser; compact?: boolean }) {
  const can = { buch: canArea(user, "buchhaltung"), auf: canArea(user, "auftraege"), lager: canArea(user, "lager"), ein: canArea(user, "einkauf") };
  if (!can.buch && !can.auf && !can.lager && !can.ein) return null;
  const [sales, orders, article, stock, purchase] = await Promise.all([
    can.buch ? salesTiles() : null,
    can.auf ? orderTiles() : null,
    can.buch ? articleTile() : null,
    can.lager ? stockTile() : null,
    can.ein ? purchaseTiles() : null,
  ]);
  const verkauf = sales || orders;
  const stamm = article || stock;

  return (
    <section className={clsx("relative rounded-[28px] bg-gradient-to-br from-brand to-brand-2 text-white", compact ? "p-5 md:p-6" : "p-5 md:p-8")} aria-labelledby="ablauf-titel">
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(125,211,252,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,.3)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="absolute -top-24 -right-24 size-72 rounded-full bg-sky-400/20 blur-3xl" />
      </div>
      <div className="relative">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Workflow className="size-5 text-sky-200" />
          <h2 id="ablauf-titel" className="text-lg font-bold tracking-tight">Arbeitsablauf</h2>
          <span className="text-sm text-sky-100">Kachel anklicken – Übersicht, Neu oder direkt zum Vorgang.</span>
          {compact && <Link href="/ablauf" className="ml-auto rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/30 hover:bg-white/25">Groß öffnen</Link>}
        </div>

        <div className={clsx("grid gap-8", verkauf && (stamm || purchase) ? "lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1fr)]" : "")}>
          {verkauf && (
            <Lane title="Verkauf" hint="vom Kunden bis zum Geld">
              {/* PC: wie gewohnt im U – Angebot → Auftragsbestätigung ↓ Lieferschein → Rechnung */}
              <div className="hidden grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] grid-rows-[auto_32px_auto_32px_auto] md:grid">
                {sales && <div className="col-start-1 row-start-1">{T(sales.kunde)}</div>}
                {sales && <Arrow dir="down" className="col-start-1 row-start-2" />}
                {sales && <div className="col-start-1 row-start-3">{T(sales.angebot)}</div>}
                {sales && orders && <Arrow dir="right" className="col-start-2 row-start-3" />}
                {orders && <div className="col-start-3 row-start-3">{T(orders.ab)}</div>}
                {orders && <Arrow dir="down" className="col-start-3 row-start-4" />}
                {orders && <div className="col-start-3 row-start-5">{T(orders.lieferschein)}</div>}
                {sales && orders && <Arrow dir="left" className="col-start-2 row-start-5" />}
                {sales && <div className="col-start-1 row-start-5">{T(sales.rechnung)}</div>}
                {sales && !orders && <Arrow dir="down" className="col-start-1 row-start-4" />}
              </div>
              {/* Handy: eine Spalte in Reihenfolge */}
              <div className="space-y-2 md:hidden">
                {[sales?.kunde, sales?.angebot, orders?.ab, orders?.lieferschein, sales?.rechnung].filter((t): t is Tile => Boolean(t)).map((t, i) => (
                  <div key={t.title}>
                    {i > 0 && <Arrow dir="down" className="h-5" />}
                    {T(t)}
                  </div>
                ))}
              </div>
            </Lane>
          )}

          {stamm && (
            <Lane title="Stammdaten" hint="Artikel & Material">
              <div className="space-y-2 md:space-y-0">
                {article && T(article)}
                {article && stock && <div className="hidden h-8 md:block" />}
                {article && stock && <div className="h-2 md:hidden" />}
                {stock && T(stock)}
              </div>
            </Lane>
          )}

          {purchase && (
            <Lane title="Einkauf" hint="Material besorgen">
              <div className="space-y-0">
                {T(purchase.lieferant)}
                <Arrow dir="down" className="h-5 md:h-8" />
                {T(purchase.bestellung)}
                <Arrow dir="down" className="h-5 md:h-8" />
                {T(purchase.eingang)}
              </div>
            </Lane>
          )}
        </div>
      </div>
    </section>
  );
}
