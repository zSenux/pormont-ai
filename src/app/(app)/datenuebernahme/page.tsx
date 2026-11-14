import Link from "next/link";
import { Archive, Database, FileSpreadsheet, Search, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime, formatEuro } from "@/lib/berlin";
import { ERP_KIND_LABEL, ERP_KINDS, searchRecords, type ErpKind, type TableInfo } from "@/lib/erp-import";
import { deleteImport } from "@/app/actions/datenuebernahme";
import { ActionButton } from "@/components/confirm-button";
import { ExportUpload, KindForm, TransferButton } from "./forms";

export const metadata = { title: "Datenübernahme" };
export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  nummer: "Nummer", name: "Name", anrede: "Anrede", vorname: "Vorname", nachname: "Nachname/Ansprechpartner", email: "E-Mail", telefon: "Telefon", strasse: "Straße", plz: "PLZ", ort: "Ort", notiz: "Notiz",
  beschreibung: "Beschreibung", einheit: "Einheit", preis: "Preis netto", ust: "USt", kunde: "Kunde", datum: "Datum", faellig: "Fällig/gültig bis", brutto: "Betrag brutto", netto: "Betrag netto", status: "Status", titel: "Titel/Betreff",
  adresse: "Adresse/Baustelle", start: "Beginn", ende: "Ende",
};

const zeilen = (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Zeile" : "Zeilen"}`;

export default async function DatenuebernahmePage({ searchParams }: { searchParams: Promise<{ q?: string; art?: string; offen?: string }> }) {
  const me = await requireUser();
  const admin = me.role === "ADMIN";
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const art = (ERP_KINDS as readonly string[]).includes(sp.art ?? "") ? (sp.art as ErpKind) : undefined;
  const offen = sp.offen === "1";
  const [imports, counts, stats, hits] = await Promise.all([
    db.erpImport.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.erpRecord.groupBy({ by: ["importId", "table", "kind"], _count: { _all: true } }),
    db.erpRecord.groupBy({ by: ["kind"], _count: { _all: true } }),
    q || art || offen ? searchRecords({ text: q, kind: art, offen, take: 100 }) : Promise.resolve([]),
  ]);
  const done = await db.erpRecord.groupBy({ by: ["importId", "table"], where: { OR: [{ lexId: { not: null } }, { projectId: { not: null } }] }, _count: { _all: true } });
  const failed = await db.erpRecord.groupBy({ by: ["importId", "table"], where: { error: { not: null }, lexId: null, projectId: null }, _count: { _all: true } });
  const openInvoices = await searchRecords({ offen: true, take: 5000 });
  const openSum = openInvoices.reduce((s, r) => s + (r.amount ?? 0), 0);
  const n = (k: ErpKind) => stats.find((s) => s.kind === k)?._count._all ?? 0;
  const tableCount = (list: typeof done, importId: string, table: string) => list.find((x) => x.importId === importId && x.table === table)?._count._all ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Datenübernahme</h1>
        <p className="mt-1 text-sm text-steel">Kunden, Artikel, Rechnungen, Angebote und Projekte aus dem alten ERP/Rechnungsprogramm übernehmen.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-steel">Kunden</p><p className="text-2xl font-semibold">{n("kunde").toLocaleString("de-DE")}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Artikel/Leistungen</p><p className="text-2xl font-semibold">{n("artikel").toLocaleString("de-DE")}</p></div>
        <div className="card p-4"><p className="text-xs text-steel">Rechnungen / Angebote</p><p className="text-2xl font-semibold">{n("rechnung").toLocaleString("de-DE")} / {n("angebot").toLocaleString("de-DE")}</p></div>
        <Link href="/datenuebernahme?offen=1" className="card p-4 transition hover:border-brand"><p className="text-xs text-steel">Offene Alt-Rechnungen</p><p className="text-2xl font-semibold text-brand">{openInvoices.length ? formatEuro(openSum) : "–"}</p></Link>
      </section>

      {admin && (
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="size-4 text-brand" /> Export aus dem alten Programm hochladen</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-steel">
            <li>Im alten Programm die Daten exportieren (Excel, CSV oder JSON) – Kunden, Artikel, Rechnungen, Angebote, Projekte.</li>
            <li>Hier hochladen. Jarvis erkennt Tabellen und Spalten selbst, du prüfst unten die Zuordnung.</li>
            <li>Kunden und Artikel per Knopf in die Buchhaltung, Projekte nach Jarvis übernehmen. Doppelte werden erkannt und nur verknüpft.</li>
            <li>Alte Rechnungen und Angebote bleiben als Archiv – sie bekommen keine neue Rechnungsnummer. Jarvis findet sie trotzdem („Was hat Müller 2025 bezahlt?“).</li>
          </ol>
          <ExportUpload />
        </section>
      )}

      <form className="flex flex-wrap gap-2" action="/datenuebernahme">
        <input name="q" defaultValue={q} placeholder="Im Archiv suchen: Kunde, Rechnungsnummer, Artikel …" className="input min-w-0 flex-1 basis-full sm:basis-0" aria-label="Archiv durchsuchen" />
        <select name="art" defaultValue={art ?? ""} className="input w-auto flex-1 sm:flex-none" aria-label="Art">
          <option value="">Alle Arten</option>
          {ERP_KINDS.map((k) => <option key={k} value={k}>{ERP_KIND_LABEL[k]}</option>)}
        </select>
        <button className="btn-secondary" aria-label="Suchen"><Search className="size-4" /></button>
      </form>

      {(q || art || offen) && (
        <section className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Archive className="size-4 text-brand" /> {offen ? "Offene Rechnungen aus dem alten Programm" : "Treffer"} <span className="text-sm font-normal text-steel">{hits.length}{hits.length === 100 ? "+" : ""}</span></h2>
          {hits.length === 0 ? (
            <p className="mt-2 text-sm text-steel">Nichts gefunden.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {hits.map((r) => (
                <li key={r.id}>
                  <Link href={`/datenuebernahme/${r.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm hover:text-brand">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="font-medium">{[r.number, r.party ?? r.name].filter(Boolean).join(" · ") || "(ohne Namen)"}</span>
                      {r.party && r.name ? <span className="text-steel"> · {r.name}</span> : null}
                      <span className="block text-xs text-steel">{ERP_KIND_LABEL[r.kind as ErpKind]}{r.date ? ` · ${formatDate(r.date)}` : ""}{r.status ? ` · ${r.status}` : ""}{r.lexId ? (r.lexId.includes("-") ? " · in Lexware" : " · übernommen") : ""}{r.projectId ? " · als Projekt" : ""}</span>
                    </span>
                    {r.amount !== null && <span className="shrink-0 font-semibold">{formatEuro(r.amount)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Database className="size-5 text-brand" /> Importierte Dateien</h2>
        {imports.length === 0 && <p className="card p-5 text-sm text-steel">Noch nichts importiert.{admin ? " Sobald der Export aus dem alten Programm da ist, oben hochladen." : ""}</p>}
        {imports.map((imp) => {
          const tables = (imp.tables ?? []) as TableInfo[];
          return (
            <article key={imp.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold [overflow-wrap:anywhere]">{imp.fileName}</p>
                  <p className="text-xs text-steel">{imp.format.toUpperCase()} · {zeilen(imp.rows)} · {formatDateTime(imp.createdAt)}{imp.userName ? ` · ${imp.userName}` : ""}</p>
                </div>
                {imp.busy && <span className="chip bg-amber-50 px-2 py-0.5 text-[11px] text-warn">Übernahme läuft …</span>}
                {admin && (
                  <ActionButton action={deleteImport.bind(null, imp.id)} confirm={`„${imp.fileName}“ mit allen Datensätzen aus dem Archiv löschen? Bereits übernommene Kunden, Artikel und Projekte bleiben dort.`} className="btn-secondary px-2 py-1.5" title="Import löschen">
                    <Trash2 className="size-4" />
                  </ActionButton>
                )}
              </div>
              <ul className="space-y-3">
                {tables.map((t) => {
                  const total = counts.find((c) => c.importId === imp.id && c.table === t.name)?._count._all ?? t.rows;
                  const moved = tableCount(done, imp.id, t.name);
                  const errors = tableCount(failed, imp.id, t.name);
                  const fields = Object.entries(t.mapping);
                  return (
                    <li key={t.name} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{t.name} <span className="text-sm font-normal text-steel">· {zeilen(total)}</span></p>
                        {admin && moved === 0 ? (
                          <KindForm importId={imp.id} table={t.name} kind={t.kind} />
                        ) : (
                          <span className={clsx("chip px-2 py-0.5 text-[11px]", t.kind === "sonstiges" ? "bg-mist text-steel" : "bg-brand-soft text-brand")}>{ERP_KIND_LABEL[t.kind]}</span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-steel [overflow-wrap:anywhere]">
                        {fields.length ? fields.map(([f, h]) => `${FIELD_LABEL[f] ?? f} ← „${h}“`).join(" · ") : `Keine Spalten zugeordnet. Spalten: ${t.headers.slice(0, 15).join(", ")}${t.headers.length > 15 ? " …" : ""}`}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <Link href={`/datenuebernahme?art=${t.kind}`} className="text-brand">Datensätze ansehen</Link>
                        {(t.kind === "kunde" || t.kind === "artikel" || t.kind === "projekt") && (
                          <span className="text-steel">{moved.toLocaleString("de-DE")} von {total.toLocaleString("de-DE")} übernommen{errors ? <span className="text-bad"> · {errors} mit Fehler</span> : null}</span>
                        )}
                        {admin && !imp.busy && moved < total && t.kind === "kunde" && (
                          <TransferButton importId={imp.id} what="kunde" label="Kunden übernehmen" confirm={`${total - moved} Kunden in der Buchhaltung anlegen? Kunden mit gleichem Namen, die es schon gibt, werden nur verknüpft.`} />
                        )}
                        {admin && !imp.busy && moved < total && t.kind === "artikel" && (
                          <TransferButton importId={imp.id} what="artikel" label="Artikel übernehmen" confirm={`${total - moved} Artikel/Leistungen in den Artikelstamm übernehmen? Gleiche Artikelnummern werden nur verknüpft.`} />
                        )}
                        {admin && !imp.busy && moved < total && t.kind === "projekt" && (
                          <TransferButton importId={imp.id} what="projekt" label="Als Projekte anlegen" confirm={`${total - moved} Projekte in Jarvis anlegen? Gleichnamige Projekte werden nur verknüpft.`} />
                        )}
                        {(t.kind === "rechnung" || t.kind === "angebot") && <span className="text-steel">bleibt als Archiv (Jarvis findet es)</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </section>
    </main>
  );
}
