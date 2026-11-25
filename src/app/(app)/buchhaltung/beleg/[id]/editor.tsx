"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ExternalLink, Eye, EyeOff, FileDown, Loader2, Lock, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { computeTotals, fmtEuroCents, lineNetCents, UNIT_SUGGESTIONS, type Line } from "@/lib/buchhaltung/money";
import { deleteDraftAction, finalizeAction, saveDraftAction } from "@/app/actions/buchhaltung";
import type { DraftInput } from "@/lib/buchhaltung/docs";
import { PdfPages } from "@/components/pdf-preview";

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
  invoiceType: "NORMAL" | "ABSCHLAG" | "SCHLUSS";
  deductionIds: string[];
};

/** Abschlagsrechnung, die in einer Schlussrechnung abgezogen werden kann */
export type DownPayment = { id: string; number: string; date: string; title: string | null; netCents: number; taxCents: number; grossCents: number; paid: boolean };

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

export type EditorTextBlock = { title: string; text: string };

/** Auswahl „Textbaustein einfügen“ – hängt den Text als eigenen Absatz an */
function BlockPicker({ blocks, value, onPick, label }: { blocks: EditorTextBlock[]; value: string; onPick: (v: string) => void; label: string }) {
  if (!blocks.length) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        const b = blocks[Number(e.target.value)];
        if (!b) return;
        if (value.includes(b.text)) return;
        onPick(value.trim() ? `${value.trimEnd()}\n\n${b.text}` : b.text);
      }}
      className="input w-auto py-1 text-xs"
      aria-label={label}
    >
      <option value="">+ Textbaustein …</option>
      {blocks.map((b, i) => <option key={i} value={i} disabled={value.includes(b.text)}>{b.title}{value.includes(b.text) ? " ✓" : ""}</option>)}
    </select>
  );
}

export type NextNumber = { n: number; number: string; lexware: boolean };

export function DocEditor({ doc, customers, projects, articles, defaultPaymentDays, downPayments = [], textBlocks = [], nextNumber }: { doc: EditorDoc; customers: Customer[]; projects: { id: string; name: string }[]; articles: Article[]; defaultPaymentDays: number; downPayments?: DownPayment[]; textBlocks?: EditorTextBlock[]; nextNumber?: NextNumber }) {
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
    invoiceType: doc.invoiceType,
  });
  const [ded, setDed] = useState<string[]>(doc.deductionIds);
  const [rows, setRows] = useState<Row[]>(() => (doc.lines.length ? doc.lines.map(toRow) : [emptyRow()]));
  const [pick, setPick] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const chosen = f.invoiceType === "SCHLUSS" ? downPayments.filter((x) => ded.includes(x.id)) : [];
  const prepaid = chosen.reduce((s, x) => s + x.grossCents, 0);
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
      ...(invoice ? { invoiceType: f.invoiceType, deductionIds: f.invoiceType === "SCHLUSS" ? ded : [] } : {}),
    };
  }

  // Rückfrage vor dem Speichern/Fertigstellen: Entwurf behalten oder mit fortlaufender Nummer fertigstellen
  const [ask, setAsk] = useState<null | "save" | "final">(null);
  const [wantNo, setWantNo] = useState(() => (nextNumber ? (nextNumber.lexware ? nextNumber.number : String(nextNumber.n)) : ""));
  const docName = doc.kind === "ANGEBOT" ? "Angebot" : f.invoiceType === "ABSCHLAG" ? "Abschlagsrechnung" : f.invoiceType === "SCHLUSS" ? "Schlussrechnung" : "Rechnung";

  function run(kind: "save" | "final", number?: number | null) {
    if (bad) return setMsg({ error: "Bitte Mengen und Preise als Zahl eintragen (z. B. 12,5)." });
    setAsk(null);
    start(async () => {
      const r = kind === "final" ? await finalizeAction(doc.id, payload(), number) : await saveDraftAction(doc.id, payload());
      setMsg(kind === "save" && r?.ok ? { ok: `Als Entwurf gespeichert – noch ohne Nummer. Zum Verschicken auf „Fertigstellen“ klicken.` } : (r ?? null));
      if (r?.ok) router.refresh();
    });
  }

  function confirmFinal() {
    const n = Number(wantNo.trim().replace(/\D/g, ""));
    if (!Number.isInteger(n) || n < 1) return setMsg({ error: "Bitte eine gültige Nummer eingeben." });
    run("final", n === (nextNumber?.n ?? n) ? null : n);
  }

  // ---------- Live-Vorschau: PDF mit Briefpapier und Fußzeile, aus den ungespeicherten Eingaben ----------
  const wide = useWide();
  const [side, setSide] = useState(true);
  const [sheet, setSheet] = useState(false);
  const showPreview = wide ? side : sheet;
  const [pdf, setPdf] = useState<{ data: ArrayBuffer; url: string } | null>(null);
  const [pv, setPv] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const hasPdf = useRef(false);
  const previewKey = bad ? null : JSON.stringify(payload());
  useEffect(() => {
    if (!showPreview || !previewKey) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPv({ busy: true });
      try {
        const r = await fetch(`/api/buchhaltung/vorschau/${doc.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: previewKey, signal: ctrl.signal, cache: "no-store" });
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Fehler ${r.status}`);
        const data = await r.arrayBuffer();
        const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
        hasPdf.current = true;
        setPdf((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { data, url };
        });
        setPv({ busy: false });
      } catch (e) {
        if (!ctrl.signal.aborted) setPv({ busy: false, error: e instanceof Error ? e.message : "Vorschau fehlgeschlagen." });
      }
    }, hasPdf.current ? 700 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [previewKey, showPreview, doc.id]);
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    lastUrl.current = pdf?.url ?? null;
  }, [pdf]);
  useEffect(() => () => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
  }, []);
  const fileName = `${doc.kind === "ANGEBOT" ? "Angebot" : doc.kind === "GUTSCHRIFT" ? "Gutschrift" : "Rechnung"}_Entwurf.pdf`;
  const previewPanel = (onClose: () => void, bodyClass: string) => (
    <section className="card flex flex-col overflow-hidden" aria-label="PDF-Vorschau">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="font-semibold">Vorschau</h2>
        <span className="mr-auto flex items-center gap-1 text-xs text-steel">{pv.busy ? <><Loader2 className="size-3.5 animate-spin" /> aktualisiert …</> : pv.error ? <span className="text-bad">{pv.error}</span> : pdf ? "live, so geht der Beleg raus" : null}</span>
        {pdf && <a href={pdf.url} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-steel hover:bg-mist hover:text-brand" title="In neuem Tab öffnen"><ExternalLink className="size-4" /></a>}
        {pdf && <a href={pdf.url} download={fileName} className="rounded-lg p-1.5 text-steel hover:bg-mist hover:text-brand" title="Herunterladen"><FileDown className="size-4" /></a>}
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-steel hover:bg-mist" title="Vorschau schließen" aria-label="Vorschau schließen"><X className="size-4" /></button>
      </div>
      <div className={`overflow-y-auto bg-mist p-3 ${bodyClass}`}>
        {!pdf && (pv.busy || !pv.error) && <p className="flex items-center gap-2 py-10 text-sm text-steel"><Loader2 className="size-4 animate-spin" /> PDF wird erstellt …</p>}
        {bad && <p className="mb-2 text-sm text-warn">Mengen und Preise als Zahl eintragen – dann aktualisiert sich die Vorschau.</p>}
        <PdfPages data={pdf?.data ?? null} />
      </div>
    </section>
  );

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
    <div className={wide && side ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,38rem)]" : undefined}>
    <div className="min-w-0 space-y-4">
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
          {customer && !customer.complete && <span className="mt-1 block text-xs text-warn">Beim Kunden fehlt die vollständige Anschrift – vor dem Fertigstellen <Link className="underline" href={`/buchhaltung/kunden/${customer.id}`}>ergänzen</Link>.</span>}
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
          <div className="block sm:col-span-2">
            <span className="label">Rechnungsart</span>
            <div className="flex flex-wrap gap-2">
              {([["NORMAL", "Rechnung"], ["ABSCHLAG", "Abschlagsrechnung"], ["SCHLUSS", "Schlussrechnung"]] as const).map(([k, l]) => (
                <label key={k} className={`chip cursor-pointer px-3 py-1.5 ${f.invoiceType === k ? "border-brand bg-brand text-white" : "bg-mist text-steel"}`}>
                  <input type="radio" name="invoiceType" value={k} checked={f.invoiceType === k} onChange={() => set("invoiceType", k)} className="sr-only" />
                  {l}
                </label>
              ))}
            </div>
            {f.invoiceType === "ABSCHLAG" && <p className="mt-1 text-xs text-steel">Teilbetrag vor Fertigstellung. Wird später in der Schlussrechnung abgezogen.</p>}
            {f.invoiceType === "SCHLUSS" && (
              <div className="mt-2 rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">Abzuziehende Abschläge</p>
                {downPayments.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {downPayments.map((x) => (
                      <li key={x.id}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={ded.includes(x.id)} onChange={(e) => setDed((l) => (e.target.checked ? [...l, x.id] : l.filter((y) => y !== x.id)))} className="mt-1" />
                          <span className="flex-1">{x.number} vom {x.date.split("-").reverse().join(".")}{x.title ? ` · ${x.title}` : ""} <span className="text-steel">· {fmtEuroCents(x.grossCents)} brutto · {x.paid ? "bezahlt" : "noch offen"}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-steel">Keine offenen Abschlagsrechnungen für diesen Kunden{f.customerId !== (doc.customerId ?? "") ? " – nach dem Kundenwechsel erst speichern" : ""}.</p>
                )}
                <p className="mt-2 text-xs text-steel">In die Positionen gehört die gesamte Leistung. Die Abschläge werden mit ihrer Umsatzsteuer abgezogen; nicht bezahlte Abschläge bleiben zusätzlich offen.</p>
              </div>
            )}
          </div>
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
        <fieldset className="sm:col-span-2">
          <legend className="label">Umsatzsteuer</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm ${!f.reverseCharge ? "border-brand bg-brand/5" : "border-line"}`}>
              <input type="radio" name="ust-art" checked={!f.reverseCharge} onChange={() => set("reverseCharge", false)} className="mt-1" />
              <span><strong>Normal mit MwSt.</strong><span className="block text-xs text-steel">netto + 19 % USt. = brutto</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm ${f.reverseCharge ? "border-brand bg-brand/5" : "border-line"}`}>
              <input type="radio" name="ust-art" checked={f.reverseCharge} onChange={() => set("reverseCharge", true)} className="mt-1" />
              <span><strong>§ 13b UStG – netto</strong><span className="block text-xs text-steel">Bauleistung an Bauunternehmen: keine USt., der Kunde schuldet die Steuer</span></span>
            </label>
          </div>
          {f.reverseCharge && customer && !customer.vatId && <p className="mt-1 text-sm text-steel">Tipp: USt-IdNr. des Kunden in den Kundendaten ergänzen – nötig nur für Kunden im Ausland und für XRechnungen an Behörden.</p>}
        </fieldset>
        <div className="block sm:col-span-2">
          <div className="flex items-end justify-between gap-2"><label htmlFor="beleg-intro" className="label">Einleitung</label><BlockPicker blocks={textBlocks} value={f.intro} onPick={(v) => set("intro", v)} label="Textbaustein in die Einleitung" /></div>
          <textarea id="beleg-intro" value={f.intro} onChange={(e) => set("intro", e.target.value)} rows={2} className="input resize-y" />
        </div>
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
                    <input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} maxLength={300} placeholder="Text, z. B. Edelstahl-Geländer V2A" className="input font-medium" aria-label="Text" />
                    {r.open ? (
                      <textarea value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} rows={2} maxLength={4000} placeholder="Beschreibung (Material, Maße, Ausführung …)" className="input resize-y text-sm" aria-label="Beschreibung" />
                    ) : (
                      <button type="button" onClick={() => setRow(r.key, { open: true })} className="text-xs text-brand">+ Beschreibung</button>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_6rem_8rem_5rem_6rem_1fr]">
                      <label className="text-xs text-steel">Menge<input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} inputMode="decimal" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Einheit<input value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} list="einheiten" maxLength={30} className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Einzelpreis netto €<input value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value })} inputMode="decimal" placeholder="0,00" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">Rabatt %<input value={r.discount} onChange={(e) => setRow(r.key, { discount: e.target.value })} inputMode="decimal" placeholder="0" className="input mt-0.5" /></label>
                      <label className="text-xs text-steel">USt.<select value={r.taxRate} onChange={(e) => setRow(r.key, { taxRate: Number(e.target.value) as Row["taxRate"] })} className="input mt-0.5" disabled={f.reverseCharge}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></select></label>
                      <p className="col-span-2 self-end pb-2 text-right text-sm font-semibold sm:col-span-1"><span className="block text-xs font-normal text-steel">Gesamtpreis</span>{net}</p>
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
          {chosen.map((x) => <div key={x.id} className="flex justify-between"><dt className="text-steel">abzgl. Abschlag {x.number}</dt><dd>− {fmtEuroCents(x.grossCents)}</dd></div>)}
          {chosen.length > 0 && <div className={`flex justify-between border-t border-line pt-1 text-base font-bold ${prepaid > totals.grossCents ? "text-bad" : ""}`}><dt>Noch zu zahlen</dt><dd>{fmtEuroCents(totals.grossCents - prepaid)}</dd></div>}
        </dl>
      </section>

      <section className="card p-4">
        <div className="flex items-end justify-between gap-2"><label htmlFor="beleg-outro" className="label">Schlusstext (steht unten auf dem Beleg)</label><BlockPicker blocks={textBlocks} value={f.outro} onPick={(v) => set("outro", v)} label="Textbaustein in den Schlusstext" /></div>
        <textarea id="beleg-outro" value={f.outro} onChange={(e) => set("outro", e.target.value)} rows={Math.min(8, Math.max(2, f.outro.split("\n").length + 1))} className="input resize-y" />
        {textBlocks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {textBlocks.map((b, i) => {
              const on = f.outro.includes(b.text);
              return (
                <button key={i} type="button" onClick={() => set("outro", on ? f.outro.replace(b.text, "").replace(/\n{3,}/g, "\n\n").trim() : f.outro.trim() ? `${f.outro.trimEnd()}\n\n${b.text}` : b.text)} className={`chip px-2.5 py-1 ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand"}`}>
                  {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} {b.title}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-4">
        <button type="button" onClick={() => (doc.kind === "RECHNUNG" && nextNumber ? setAsk("save") : run("save"))} disabled={pending} className="btn-secondary">{pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Speichern</button>
        <button type="button" onClick={() => (wide ? setSide((v) => !v) : setSheet(true))} className="btn-secondary">{wide && side ? <><EyeOff className="size-4" /> Vorschau aus</> : <><Eye className="size-4" /> Vorschau</>}</button>
        {doc.kind !== "GUTSCHRIFT" && <button type="button" onClick={() => setAsk("final")} disabled={pending} className="btn-primary"><Lock className="size-4" /> Fertigstellen{nextNumber ? ` als Nr. ${nextNumber.number}` : ""}</button>}
        <button type="button" onClick={() => { if (window.confirm("Entwurf löschen?")) start(() => deleteDraftAction(doc.id)); }} disabled={pending} className="btn-danger ml-auto"><Trash2 className="size-4" /><span className="hidden sm:inline">Entwurf löschen</span></button>
        {msg?.error && <p className="w-full text-sm text-bad" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="flex w-full items-center gap-1 text-sm text-ok"><Check className="size-4" /> {msg.ok}</p>}
      </div>
    </div>
    {ask && (
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fertig-titel" onClick={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-white p-5 shadow-xl">
          <h2 id="fertig-titel" className="text-lg font-semibold">{ask === "save" ? `${docName} fertigstellen oder als Entwurf speichern?` : `${docName} fertigstellen?`}</h2>
          <p className="text-sm text-steel">Beim Fertigstellen bekommt {doc.kind === "ANGEBOT" ? "das Angebot" : "die Rechnung"} die fortlaufende Nummer, das PDF wird erstellt und kann sofort verschickt werden. Danach ist keine Änderung mehr möglich (GoBD) – Korrektur nur per Storno.</p>
          <label className="block">
            <span className="label">Nummer</span>
            <input value={wantNo} onChange={(e) => setWantNo(e.target.value)} inputMode="numeric" className="input text-lg font-semibold" aria-describedby="fertig-nr-hinweis" />
            <span id="fertig-nr-hinweis" className="mt-1 block text-xs text-steel">Vorschlag: nächste freie Nummer {nextNumber?.number}{nextNumber && !nextNumber.lexware ? ` (hier nur die laufende Zahl eingeben, z. B. ${nextNumber.n})` : ""}. Eine andere freie Nummer ist möglich, danach wird von dort weitergezählt.</span>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={confirmFinal} disabled={pending} className="btn-primary"><Lock className="size-4" /> Fertigstellen mit Nr. {nextNumber?.lexware ? wantNo.trim() || "…" : wantNo.trim() ? `${nextNumber?.number.replace(/\d+$/, "")}${wantNo.trim().padStart(4, "0")}` : "…"}</button>
            {ask === "save" && <button type="button" onClick={() => run("save")} disabled={pending} className="btn-secondary"><Save className="size-4" /> Nur als Entwurf speichern</button>}
            <button type="button" onClick={() => setAsk(null)} className="btn-secondary ml-auto">Abbrechen</button>
          </div>
        </div>
      </div>
    )}
    {wide && side && <aside className="sticky top-20 min-w-0">{previewPanel(() => setSide(false), "max-h-[calc(100vh-8.5rem)]")}</aside>}
    {!wide && sheet && (
      <div className="fixed inset-0 z-[70] flex flex-col bg-ink/60 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]" role="dialog" aria-modal="true" aria-label="PDF-Vorschau">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col [&>section]:min-h-0 [&>section]:flex-1">{previewPanel(() => setSheet(false), "flex-1")}</div>
      </div>
    )}
    </div>
  );
}

/** Breiter Bildschirm (ab 1280 px): Vorschau steht neben dem Formular, sonst als Vollbild-Fenster */
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 1280px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => false,
  );
}

function articleLabel(a: Article) {
  return `${a.name}${a.number ? ` · Nr. ${a.number}` : ""} · ${a.priceNet.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}/${a.unit}`;
}
