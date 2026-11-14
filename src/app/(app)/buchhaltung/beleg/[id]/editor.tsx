"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Eye, Loader2, Lock, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { computeTotals, fmtEuroCents, lineNetCents, UNIT_SUGGESTIONS, type Line } from "@/lib/buchhaltung/money";
import { deleteDraftAction, finalizeAction, saveDraftAction } from "@/app/actions/buchhaltung";
import type { DraftInput } from "@/lib/buchhaltung/docs";

type Customer = { id: string; name: string; number: number | null; city: string | null; vatId: string | null; complete: boolean };
type Article = { id: string; name: string; number: string | null; unit: string; priceNet: number; taxRate: number; description: string | null };
type Row = { key: number; articleId: string | null; name: string; description: string; qty: string; unit: string; price: string; discount: string; taxRate: 19 | 7 | 0; open: boolean };

export type EditorDoc = {
  id: string;
  kind: "ANGEBOT" | "RECHNUNG" | "GUTSCHRIFT";
  customerId: string | null;
  projectId: string | null;
  title: string | null;
  intro: string | null;
  outro: string | null;
  date: string;
  serviceFrom: string | null;
  serviceTo: string | null;
  dueDate: string | null;
  paymentDays: number | null;
  reverseCharge: boolean;
  lines: Line[];
};

const de = (n: number, max = 4) => (Number.isFinite(n) ? n.toLocaleString("de-DE", { maximumFractionDigits: max, useGrouping: false }) : "");
const parse = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return 0;
  // „1.234,5“ → 1234.5; „12.5“ (ohne Komma) → 12.5
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
};

let seq = 1;
const toRow = (l: Line): Row => ({ key: seq++, articleId: l.articleId ?? null, name: l.name, description: l.description ?? "", qty: de(l.qty, 3), unit: l.unit, price: de(l.price), discount: l.discount ? de(l.discount, 2) : "", taxRate: l.taxRate, open: Boolean(l.description) });
const emptyRow = (): Row => ({ key: seq++, articleId: null, name: "", description: "", qty: "1", unit: "Stk", price: "", discount: "", taxRate: 19, open: false });

export function DocEditor({ doc, customers, projects, articles, defaultPaymentDays }: { doc: EditorDoc; customers: Customer[]; projects: { id: string; name: string }[]; articles: Article[]; defaultPaymentDays: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [f, setF] = useState({
    customerId: doc.customerId ?? "",
    projectId: doc.projectId ?? "",
    title: doc.title ?? "",
    intro: doc.intro ?? "",
    outro: doc.outro ?? "",
    date: doc.date,
    serviceFrom: doc.serviceFrom ?? "",
    serviceTo: doc.serviceTo ?? "",
    dueDate: doc.dueDate ?? "",
    paymentDays: doc.paymentDays !== null ? String(doc.paymentDays) : "",
    reverseCharge: doc.reverseCharge,
  });
  const [rows, setRows] = useState<Row[]>(() => (doc.lines.length ? doc.lines.map(toRow) : [emptyRow()]));
  const [pick, setPick] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const invoice = doc.kind === "RECHNUNG";
  const customer = customers.find((c) => c.id === f.customerId);

  const lines = useMemo(
    () =>
      rows
        .filter((r) => r.name.trim() || r.price.trim())
        .map((r) => ({ articleId: r.articleId, name: r.name.trim() || "Position", description: r.description.trim() || null, qty: parse(r.qty), unit: r.unit.trim() || "Stk", price: parse(r.price), discount: parse(r.discount) || 0, taxRate: r.taxRate }) as Line),
    [rows],
  );
  const bad = lines.some((l) => !Number.isFinite(l.qty) || !Number.isFinite(l.price) || !Number.isFinite(l.discount));
  const totals = computeTotals(bad ? [] : lines, f.reverseCharge);

  function payload(): DraftInput {
    const days = f.paymentDays.trim() ? Math.round(parse(f.paymentDays)) : null;
    return {
      customerId: f.customerId || null,
      projectId: f.projectId || null,
      title: f.title,
      intro: f.intro,
      outro: f.outro,
      date: f.date,
      serviceFrom: f.serviceFrom || null,
      serviceTo: f.serviceTo || null,
      dueDate: doc.kind === "ANGEBOT" ? f.dueDate || null : undefined,
      paymentDays: invoice ? (Number.isFinite(days) ? days : null) : undefined,
      reverseCharge: f.reverseCharge,
      lines,
    };
  }

  function run(kind: "save" | "preview" | "final") {
    if (bad) return setMsg({ error: "Bitte Mengen und Preise als Zahl eintragen (z. B. 12,5)." });
    if (kind === "final" && !window.confirm(`${doc.kind === "ANGEBOT" ? "Angebot" : "Rechnung"} jetzt festschreiben?\n\nDanach bekommt der Beleg seine Nummer und kann nicht mehr geändert werden (GoBD). Korrektur nur noch per Storno.`)) return;
    // Vorschau-Fenster sofort öffnen (sonst blockt Safari das Pop-up), Adresse nach dem Speichern setzen
    const win = kind === "preview" ? window.open("about:blank", "_blank") : null;
    start(async () => {
      const r = kind === "final" ? await finalizeAction(doc.id, payload()) : await saveDraftAction(doc.id, payload());
      setMsg(r ?? null);
      if (kind === "preview") {
        if (r?.ok && win) win.location.href = `/api/buchhaltung/pdf/${doc.id}?t=${Date.now()}`;
        else win?.close();
      }
      if (r?.ok) router.refresh();
    });
  }

  function addArticle(label: string) {
    const a = articles.find((x) => articleLabel(x) === label);
    if (!a) return;
    setRows((r) => [...r.filter((x) => x.name.trim() || x.price.trim()), { key: seq++, articleId: a.id, name: a.name, description: a.description ?? "", qty: "1", unit: a.unit, price: de(a.priceNet), discount: "", taxRate: ([19, 7, 0].includes(a.taxRate) ? a.taxRate : 19) as Row["taxRate"], open: Boolean(a.description) }]);
    setPick("");
  }

  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const n = [...r];
    const j = i + d;
    if (j < 0 || j >= n.length) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <div className="space-y-4">
      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Kunde</span>
          <div className="flex gap-2">
            <select value={f.customerId} onChange={(e) => set("customerId", e.target.value)} className="input min-w-0 flex-1">
              <option value="">– Kunde wählen –</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.number ? ` (${c.number})` : ""}{c.city ? ` · ${c.city}` : ""}</option>)}
            </select>
            <Link href={`/buchhaltung/kunden/neu?back=/buchhaltung/beleg/${doc.id}`} className="btn-secondary shrink-0" title="Neuen Kunden anlegen"><UserPlus className="size-4" /><span className="hidden sm:inline">Neu</span></Link>
          </div>
          {customer && !customer.complete && <span className="mt-1 block text-xs text-warn">Beim Kunden fehlt die vollständige Anschrift – vor dem Festschreiben <Link className="underline" href={`/buchhaltung/kunden/${customer.id}`}>ergänzen</Link>.</span>}
        </label>
        <label className="block">
          <span className="label">Projekt / Bauvorhaben</span>
          <select value={f.projectId} onChange={(e) => set("projectId", e.target.value)} className="input">
            <option value="">Ohne Projekt</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Betreff (optional)</span>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="z. B. Edelstahl-Geländer Außentreppe" className="input" />
        </label>
        <label className="block">
          <span className="label">{doc.kind === "ANGEBOT" ? "Angebotsdatum" : "Rechnungsdatum"}</span>
          <input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} className="input" />
        </label>
        {doc.kind === "ANGEBOT" ? (
          <label className="block">
            <span className="label">Gültig bis</span>
            <input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="input" />
          </label>
        ) : (
          <label className="block">
            <span className="label">Zahlungsziel (Tage)</span>
            <input value={f.paymentDays} onChange={(e) => set("paymentDays", e.target.value)} inputMode="numeric" placeholder={`Standard ${defaultPaymentDays}`} className="input" />
          </label>
        )}
        {invoice && (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <label className="block">
              <span className="label">Leistung von</span>
              <input type="date" value={f.serviceFrom} onChange={(e) => set("serviceFrom", e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="label">Leistung bis</span>
              <input type="date" value={f.serviceTo} onChange={(e) => set("serviceTo", e.target.value)} className="input" />
            </label>
            <p className="col-span-2 text-xs text-steel">Leer = Leistungsdatum ist das Rechnungsdatum. Pflichtangabe auf jeder Rechnung.</p>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.reverseCharge} onChange={(e) => set("reverseCharge", e.target.checked)} className="mt-1" />
          <span>
            <strong>§ 13b UStG</strong> – Bauleistung an ein Bauunternehmen: keine Umsatzsteuer ausweisen, der Kunde schuldet die Steuer.
            {f.reverseCharge && customer && !customer.vatId && <span className="block text-warn">Dafür braucht der Kunde eine USt-IdNr.</span>}
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Einleitung</span>
          <textarea value={f.intro} onChange={(e) => set("intro", e.target.value)} rows={2} className="input resize-y" />
        </label>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Positionen</h2>
          {articles.length > 0 && (
            <>
              <input list="artikel-liste" value={pick} onChange={(e) => { setPick(e.target.value); addArticle(e.target.value); }} placeholder="Artikel suchen und einfügen …" className="input w-full sm:w-72" aria-label="Artikel einfügen" />
              <datalist id="artikel-liste">{articles.map((a) => <option key={a.id} value={articleLabel(a)} />)}</datalist>
            </>
          )}
        </div>
        <datalist id="einheiten">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const q = parse(r.qty), pr = parse(r.price), dc = parse(r.discount) || 0;
            const net = Number.isFinite(q) && Number.isFinite(pr) && Number.isFinite(dc) ? fmtEuroCents(lineNetCents({ name: "x", qty: q, unit: "x", price: pr, discount: dc, taxRate: 19 })) : "–";
            return (
              <li key={r.key} className="rounded-2xl border border-line p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-xs text-steel">{i + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} maxLength={300} placeholder="Bezeichnung, z. B. Edelstahl-Geländer V2A" className="input font-medium" aria-label="Bezeichnung" />
                    {r.open ? (
                      <textarea value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} rows={2} maxLength={4000} placeholder="Beschreibung (Material, Maße, Ausführung …)" className="input resize-y text-sm" aria-label="Beschreibung" />
                    ) : (
                      <button type="button" onClick={() => setRow(r.key, { open: true })} className="text-xs text-brand">+ Beschreibung</button>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_6rem_8rem_5rem_6rem_1fr]">
                      <label className="text-xs text-steel">Menge<input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} inputMode="decimal" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Einheit<input value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} list="einheiten" maxLength={30} className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Preis netto €<input value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value })} inputMode="decimal" placeholder="0,00" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Rabatt %<input value={r.discount} onChange={(e) => setRow(r.key, { discount: e.target.value })} inputMode="decimal" placeholder="0" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">USt.<select value={r.taxRate} onChange={(e) => setRow(r.key, { taxRate: Number(e.target.value) as Row["taxRate"] })} className="input mt-0.5" disabled={f.reverseCharge}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></select></label>
                      <p className="col-span-2 self-end pb-2 text-right text-sm font-semibold sm:col-span-1">{net}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg p-1.5 text-steel hover:bg-mist disabled:opacity-30" aria-label="Nach oben"><ArrowUp className="size-4" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded-lg p-1.5 text-steel hover:bg-mist disabled:opacity-30" aria-label="Nach unten"><ArrowDown className="size-4" /></button>
                    <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((y) => y.key !== r.key) : [emptyRow()]))} className="rounded-lg p-1.5 text-bad hover:bg-red-50" aria-label="Position löschen"><Trash2 className="size-4" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => setRows((r) => [...r, emptyRow()])} className="btn-secondary mt-3"><Plus className="size-4" /> Position</button>

        <dl className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-steel">Summe netto</dt><dd>{fmtEuroCents(totals.netCents)}</dd></div>
          {!f.reverseCharge && totals.taxes.map((t) => <div key={t.rate} className="flex justify-between"><dt className="text-steel">zzgl. {t.rate} % USt.</dt><dd>{fmtEuroCents(t.taxCents)}</dd></div>)}
          {f.reverseCharge && <div className="flex justify-between"><dt className="text-steel">USt. (§ 13b, schuldet der Kunde)</dt><dd>0,00 €</dd></div>}
          <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><dt>Gesamt</dt><dd>{fmtEuroCents(totals.grossCents)}</dd></div>
        </dl>
      </section>

      <section className="card p-4">
        <label className="block">
          <span className="label">Schlusstext</span>
          <textarea value={f.outro} onChange={(e) => set("outro", e.target.value)} rows={2} className="input resize-y" />
        </label>
      </section>

      <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-4">
        <button type="button" onClick={() => run("save")} disabled={pending} className="btn-secondary">{pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Speichern</button>
        <button type="button" onClick={() => run("preview")} disabled={pending} className="btn-secondary"><Eye className="size-4" /> Vorschau</button>
        {doc.kind !== "GUTSCHRIFT" && <button type="button" onClick={() => run("final")} disabled={pending} className="btn-primary"><Lock className="size-4" /> Festschreiben</button>}
        <button type="button" onClick={() => { if (window.confirm("Entwurf löschen?")) start(() => deleteDraftAction(doc.id)); }} disabled={pending} className="btn-danger ml-auto"><Trash2 className="size-4" /><span className="hidden sm:inline">Entwurf löschen</span></button>
        {msg?.error && <p className="w-full text-sm text-bad" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="flex w-full items-center gap-1 text-sm text-ok"><Check className="size-4" /> {msg.ok}</p>}
      </div>
    </div>
  );
}

function articleLabel(a: Article) {
  return `${a.name}${a.number ? ` · Nr. ${a.number}` : ""} · ${a.priceNet.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}/${a.unit}`;
}
