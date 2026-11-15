"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, DoorOpen, Fence, FileText, Info, Loader2, Rotate3d, TrendingUp, Umbrella } from "lucide-react";
import { clsx } from "clsx";
import { createQuoteAction } from "@/app/actions/vorlagen";
import { ModelViewer, type ViewerHandle } from "@/components/vorlagen/viewer";
import type { PriceTable } from "@/lib/steel";
import { calculate, defaultParams, FILL_LABEL, PARAM_SCHEMA, PRODUCT_LABEL, PRODUCTS, RAL, SURFACE_LABEL, SURFACES, type Calc, type Kalk, type Product } from "@/lib/vorlagen/model";

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const de = (n: number, d = 2) => n.toLocaleString("de-DE", { maximumFractionDigits: d });

type Field =
  | { key: string; label: string; type: "num"; unit: string; hint?: string; advanced?: boolean }
  | { key: string; label: string; type: "select"; options: [string, string][]; advanced?: boolean }
  | { key: string; label: string; type: "bool"; advanced?: boolean }
  | { key: string; label: string; type: "text"; hint?: string; advanced?: boolean };

const surface: Field[] = [
  { key: "oberflaeche", label: "Oberfläche", type: "select", options: SURFACES.map((s) => [s, SURFACE_LABEL[s]]) },
  { key: "ral", label: "Farbe (Pulver)", type: "select", options: Object.entries(RAL).map(([k, v]) => [k, `RAL ${k} ${v.name}`]) },
  { key: "montage", label: "Montage vor Ort anbieten", type: "bool" },
];

const FIELDS: Record<Product, Field[]> = {
  GELAENDER: [
    { key: "laenge", label: "Länge", type: "num", unit: "m" },
    { key: "hoehe", label: "Höhe", type: "num", unit: "mm", hint: "meist 900, ab 12 m Absturzhöhe 1.100" },
    { key: "fuellung", label: "Füllung", type: "select", options: Object.entries(FILL_LABEL) },
    { key: "befestigung", label: "Befestigung", type: "select", options: [["AUFGESETZT", "aufgesetzt (Fußplatten)"], ["SEITLICH", "seitlich (Stirnseite)"]] },
    { key: "werkstoff", label: "Werkstoff", type: "select", options: [["STAHL", "Stahl"], ["EDELSTAHL", "Edelstahl V2A"]] },
    ...surface,
    { key: "pfostenAbstand", label: "Pfostenabstand max.", type: "num", unit: "mm", advanced: true },
    { key: "pfosten", label: "Pfosten", type: "text", advanced: true },
    { key: "handlauf", label: "Handlauf", type: "text", advanced: true },
    { key: "fuellstab", label: "Füllstab", type: "text", advanced: true },
    { key: "gurt", label: "Ober-/Untergurt", type: "text", advanced: true },
  ],
  TREPPE: [
    { key: "hoehe", label: "Geschosshöhe", type: "num", unit: "mm", hint: "Fertigfußboden bis Fertigfußboden" },
    { key: "breite", label: "Laufbreite", type: "num", unit: "mm" },
    { key: "stufen", label: "Stufen", type: "select", options: [["GITTERROST", "Gitterrost"], ["BLECH", "Tränenblech, abgekantet"]] },
    { key: "gelaender", label: "Geländer", type: "select", options: [["EINSEITIG", "einseitig"], ["BEIDSEITIG", "beidseitig"], ["KEINS", "ohne"]] },
    ...surface,
    { key: "wange", label: "Wange", type: "text", advanced: true },
  ],
  VORDACH: [
    { key: "breite", label: "Breite", type: "num", unit: "mm" },
    { key: "tiefe", label: "Auskragung", type: "num", unit: "mm" },
    { key: "hoehe", label: "Unterkante über Boden", type: "num", unit: "mm" },
    { key: "eindeckung", label: "Eindeckung", type: "select", options: [["GLAS", "VSG-Glas"], ["BLECH", "Stahlblech 3 mm"]] },
    ...surface,
    { key: "rahmen", label: "Rahmenprofil", type: "text", advanced: true },
    { key: "zugstange", label: "Zugstange", type: "text", advanced: true },
  ],
  TOR: [
    { key: "breite", label: "Durchfahrtsbreite", type: "num", unit: "mm" },
    { key: "hoehe", label: "Höhe", type: "num", unit: "mm" },
    { key: "fluegel", label: "Flügel", type: "select", options: [["2", "zweiflügelig"], ["1", "einflügelig"]] },
    { key: "fuellung", label: "Füllung", type: "select", options: [["STAEBE", "senkrechte Stäbe"], ["BLECH", "Blech (blickdicht)"]] },
    { key: "antrieb", label: "mit Drehtorantrieb", type: "bool" },
    ...surface,
    { key: "rahmen", label: "Rahmen", type: "text", advanced: true },
    { key: "fuellstab", label: "Füllstab", type: "text", advanced: true },
    { key: "pfosten", label: "Pfosten", type: "text", advanced: true },
  ],
};

const ICON: Record<Product, typeof Fence> = { GELAENDER: Fence, TREPPE: TrendingUp, VORDACH: Umbrella, TOR: DoorOpen };

type Raw = Record<string, string | boolean>;
const toRaw = (p: Record<string, unknown>): Raw => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "boolean" ? v : typeof v === "number" ? String(v).replace(".", ",") : String(v)]));

function fromRaw(product: Product, raw: Raw) {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[product]) {
    const v = raw[f.key];
    if (f.type === "num") out[f.key] = Number(String(v).replace(/\./g, "").replace(",", ".").trim() || "NaN");
    else if (f.type === "bool") out[f.key] = Boolean(v);
    else if (f.key === "fluegel") out[f.key] = Number(v);
    else out[f.key] = v;
  }
  // Geländerlänge in m mit Komma – Punkt als Dezimaltrenner zulassen
  if (product === "GELAENDER") out.laenge = Number(String(raw.laenge).replace(",", "."));
  return out;
}

export function Configurator({
  steel, kalk, customers, projects, initial, admin,
}: {
  steel: PriceTable;
  kalk: Kalk;
  customers: { id: string; name: string; number: number | null }[];
  projects: { id: string; name: string }[];
  initial: Product;
  admin: boolean;
}) {
  const [product, setProduct] = useState<Product>(initial);
  const [raws, setRaws] = useState<Record<Product, Raw>>(() => Object.fromEntries(PRODUCTS.map((p) => [p, toRaw(defaultParams(p) as Record<string, unknown>)])) as Record<Product, Raw>);
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const viewer = useRef<ViewerHandle>(null);
  const raw = raws[product];
  const set = (k: string, v: string | boolean) => setRaws((r) => ({ ...r, [product]: { ...r[product], [k]: v } }));

  // Letzte gültige Berechnung behalten, solange eine Eingabe unvollständig ist
  const last = useRef<Partial<Record<Product, Calc>>>({});
  const { calc, invalid } = useMemo(() => {
    const parsed = PARAM_SCHEMA[product].safeParse(fromRaw(product, raw));
    if (!parsed.success) return { calc: last.current[product] ?? null, invalid: parsed.error.issues.map((i) => `${FIELDS[product].find((f) => f.key === i.path[0])?.label ?? i.path.join(".")}: ${i.message}`) };
    const c = calculate(product, parsed.data, steel, kalk);
    last.current[product] = c;
    return { calc: c, invalid: [] as string[] };
  }, [product, raw, steel, kalk]);

  const isEdel = product === "GELAENDER" && raw.werkstoff === "EDELSTAHL";
  const showRal = !isEdel && (raw.oberflaeche === "PULVER" || raw.oberflaeche === "DUPLEX");

  function submit() {
    setError(null);
    const parsed = PARAM_SCHEMA[product].safeParse(fromRaw(product, raw));
    if (!parsed.success) return setError("Bitte die Eingaben prüfen.");
    const image = viewer.current?.capture() ?? null;
    start(async () => {
      const r = await createQuoteAction({ product, params: parsed.data as Record<string, unknown>, customerId: customerId || null, projectId: projectId || null, image });
      if (r?.error) setError(r.error);
    });
  }

  const field = (f: Field) => {
    if (f.key === "ral" && !showRal) return null;
    if (f.key === "oberflaeche" && isEdel) return <p key={f.key} className="text-xs text-steel sm:col-span-2">Edelstahl: Oberfläche geschliffen, keine Beschichtung.</p>;
    const v = raw[f.key];
    if (f.type === "bool") {
      return (
        <label key={f.key} className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} className="size-4 accent-[var(--color-brand,#0f4d83)]" /> {f.label}
        </label>
      );
    }
    return (
      <label key={f.key} className={clsx("text-xs text-steel", f.type === "select" && "sm:col-span-2 lg:col-span-1 xl:col-span-2")}>
        {f.label}
        {f.type === "select" ? (
          <select value={String(v)} onChange={(e) => set(f.key, e.target.value)} className="input mt-1 w-full">
            {f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        ) : (
          <span className="relative mt-1 block">
            <input value={String(v)} onChange={(e) => set(f.key, e.target.value)} inputMode={f.type === "num" ? "decimal" : "text"} className={clsx("input w-full", f.type === "num" && "pr-10")} />
            {f.type === "num" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steel">{f.unit}</span>}
          </span>
        )}
        {"hint" in f && f.hint ? <span className="mt-0.5 block text-[11px]">{f.hint}</span> : null}
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRODUCTS.map((p) => {
          const I = ICON[p];
          return (
            <button key={p} type="button" onClick={() => setProduct(p)} className={clsx("card flex items-center gap-2 p-3 text-left text-sm font-semibold transition", product === p ? "border-brand bg-brand text-white" : "hover:border-brand/40")}>
              <I className="size-5 shrink-0" /> {PRODUCT_LABEL[p]}
            </button>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="card min-w-0 space-y-3 p-4">
          <h2 className="font-semibold">Maße und Ausführung</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{FIELDS[product].filter((f) => !f.advanced).map(field)}</div>
          <details>
            <summary className="cursor-pointer text-sm text-brand">Profile ändern</summary>
            <p className="mt-1 text-xs text-steel">Schreibweise wie im Stahl-Katalog, z. B. „Flachstahl 40x12“, „Quadratrohr 40x40x3“, „Rundrohr 48,3x2,6“.</p>
            <div className="mt-2 grid gap-3">{FIELDS[product].filter((f) => f.advanced).map(field)}</div>
          </details>
          {invalid.length > 0 && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{invalid.join(" · ")}</p>}
        </section>

        <section className="min-w-0 space-y-4">
          <div className="card overflow-hidden p-0">
            <ModelViewer ref={viewer} shapes={calc?.model.shapes ?? []} color={calc?.model.color ?? "#383e42"} fitKey={product} className="relative h-72 w-full bg-[#eef2f5] sm:h-[26rem]" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-steel">
              <span className="flex items-center gap-1"><Rotate3d className="size-4" /> Drehen: ziehen · Zoomen: Mausrad bzw. zwei Finger</span>
              {calc && <span>{de(calc.model.totalKg, 0)} kg Stahl · {de(calc.model.totalM2, 1)} m² Oberfläche</span>}
            </div>
          </div>

          {calc && (
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <div className="card min-w-0 p-4">
                <h2 className="font-semibold">{calc.model.title}</h2>
                <ul className="mt-2 space-y-1 text-sm text-ink/80">
                  {calc.model.specs.map((s) => <li key={s}>· {s}</li>)}
                </ul>
                {calc.model.notes.map((n) => <p key={n} className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><Info className="mt-0.5 size-3.5 shrink-0" /> {n}</p>)}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-brand">Stückliste ({calc.model.parts.length + calc.model.buy.length} Positionen)</summary>
                  <table className="mt-2 w-full text-xs">
                    <tbody className="divide-y divide-line">
                      {calc.model.parts.map((p) => (
                        <tr key={`${p.label}${p.profile}${p.lengthM}`}>
                          <td className="py-1 pr-2">{p.count} ×</td>
                          <td className="py-1 pr-2">{p.label}<span className="block text-steel">{p.profile}{p.material === "EDELSTAHL" ? " (Edelstahl)" : ""}</span></td>
                          <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{p.widthM ? `${de(p.lengthM * 1000, 0)} × ${de(p.widthM * 1000, 0)} mm` : `${de(p.lengthM * 1000, 0)} mm`}</td>
                          <td className="whitespace-nowrap py-1 text-right tabular-nums">{de(p.kg, 1)} kg</td>
                        </tr>
                      ))}
                      {calc.model.buy.map((b) => (
                        <tr key={b.label}><td className="py-1 pr-2">{de(b.qty)} {b.unit}</td><td colSpan={3} className="py-1">{b.label} <span className="text-steel">(Zukauf)</span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>

              <div className="card min-w-0 p-4">
                <h2 className="font-semibold">Kalkulation (netto)</h2>
                {calc.missing.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4" /> Für den Preis fehlen noch Werte</p>
                    <ul className="mt-1 list-disc pl-5 text-xs">{calc.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                    <p className="mt-2 text-xs">
                      Stahlpreise unter <Link href="/lieferanten/stahl" className="font-semibold underline">Stahl-Katalog</Link>,
                      {admin ? <> Stundensätze, Zeiten und Zuschläge <a href="#kalk" className="font-semibold underline">weiter unten</a>.</> : " Stundensätze und Zuschläge trägt ein Administrator ein."} Jarvis rechnet nie mit erfundenen Preisen.
                    </p>
                  </div>
                ) : (
                  <>
                    <dl className="mt-2 space-y-1 text-sm">
                      {([
                        ["Material Stahl", calc.material],
                        ...(calc.buy ? [["Zukaufteile", calc.buy]] : []),
                        ...(calc.beschichtung ? [["Beschichtung", calc.beschichtung]] : []),
                        [`Werkstatt ${de(calc.fertigungStd, 1)} Std.`, calc.fertigung],
                        ...(calc.montageStd || calc.montage ? [[`Montage ${de(calc.montageStd, 1)} Std. + Anfahrt`, calc.montage]] : []),
                        ["Zuschläge", calc.zuschlag],
                      ] as [string, number][]).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2"><dt className="text-steel">{k}</dt><dd className="tabular-nums">{euro(v)}</dd></div>
                      ))}
                      <div className="flex justify-between gap-2 border-t border-line pt-1.5 text-base font-semibold"><dt>Angebotspreis</dt><dd className="tabular-nums text-brand">{euro(calc.net)}</dd></div>
                      <div className="flex justify-between gap-2 text-xs text-steel"><dt>brutto (19 % USt.)</dt><dd className="tabular-nums">{euro(Math.round(calc.net * 119) / 100)}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-steel">Aus deinen €/kg-Preisen, Stundensätzen, Zeiten und Zuschlägen{kalk.stand ? ` (Stand ${kalk.stand.split("-").reverse().join(".")})` : ""}. Im Angebot kannst du alles noch ändern.</p>
                  </>
                )}

                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  <label className="block text-xs text-steel">Kunde
                    <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input mt-1 w-full">
                      <option value="">– später wählen –</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.number ? ` (${c.number})` : ""}</option>)}
                    </select>
                  </label>
                  {projects.length > 0 && (
                    <label className="block text-xs text-steel">Projekt (optional)
                      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input mt-1 w-full">
                        <option value="">–</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" onClick={submit} disabled={pending || calc.missing.length > 0 || invalid.length > 0} className="btn-primary w-full justify-center disabled:opacity-50">
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Als Angebot anlegen (Entwurf)
                  </button>
                  <p className="text-xs text-steel">Das Angebot bekommt die Positionen, die 3D-Ansicht als Bild im PDF und einen Link für den Kunden.</p>
                  {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{error}</p>}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
