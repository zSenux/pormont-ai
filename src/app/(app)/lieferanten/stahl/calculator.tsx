"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Boxes, Calculator, Search } from "lucide-react";
import { clsx } from "clsx";
import { addSteelToStock } from "@/app/actions/stahl";
import { ActionButton } from "@/components/confirm-button";
import {
  calcWeight, dimsText, FAMILY_LABEL, findProfile, kgText, MATERIAL_LABEL, MATERIALS, priceOf, pricePerKg, searchProfiles, STEEL_FAMILIES, STEEL_ONLY, unitWeight,
  type PriceTable, type SteelFamily, type SteelMaterial, type SteelProfile,
} from "@/lib/steel";

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Stahl-Katalog mit Rechner: Profil suchen → Stückzahl/Länge → Gewicht und (falls €/kg hinterlegt) Materialpreis
export function SteelCalculator({ prices, canStock }: { prices: PriceTable; canStock: boolean }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<SteelFamily | null>(null);
  const [material, setMaterial] = useState<SteelMaterial>("STAHL");
  const [sel, setSel] = useState<SteelProfile | null>(() => findProfile("HEB 200"));
  const [stueck, setStueck] = useState("1");
  const [laenge, setLaenge] = useState("6");
  const [breite, setBreite] = useState("1");
  const [verzinkt, setVerzinkt] = useState(false);

  const calcRef = useRef<HTMLElement>(null);
  const pick = (p: SteelProfile) => {
    setSel(p);
    // Auf dem Handy steht der Rechner unter der Liste – hinscrollen
    if (window.matchMedia("(max-width: 1023px)").matches) setTimeout(() => calcRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const list = useMemo(() => searchProfiles(q, family, 400), [q, family]);
  const calc = sel ? calcWeight({ profile: sel, material, stueck: num(stueck), laengeM: num(laenge), breiteM: num(breite) }) : null;
  const price = calc ? priceOf(prices, calc, verzinkt) : null;
  const anyPrice = prices.STAHL != null || Object.keys(prices.familien).length > 0;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <section className="card min-w-0 p-4">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="z. B. „HEB 200“, „Flachstahl 50x8“, „Rohr 60x40x3“, „Blech 5“" className="input w-full pl-9" aria-label="Profil suchen" />
          </label>
          <select value={material} onChange={(e) => setMaterial(e.target.value as SteelMaterial)} className="input w-full sm:w-auto" aria-label="Werkstoff">
            {MATERIALS.map((m) => <option key={m} value={m}>{MATERIAL_LABEL[m]}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFamily(null)} className={clsx("chip px-2.5 py-1 text-xs", !family ? "bg-brand text-white" : "bg-mist text-steel")}>Alle</button>
          {STEEL_FAMILIES.map((f) => (
            <button key={f} type="button" onClick={() => setFamily(family === f ? null : f)} className={clsx("chip px-2.5 py-1 text-xs", family === f ? "bg-brand text-white" : "bg-mist text-steel")}>{FAMILY_LABEL[f]}</button>
          ))}
        </div>
        <div className="mt-3 max-h-[32rem] overflow-y-auto">
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-steel">Nichts gefunden. Schreib das Maß z. B. als „Flachstahl 55x7“ oder „Rohr 48,3x2,6“ – dann wird es aus der Geometrie berechnet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-steel dark:bg-[var(--color-card,#101820)]">
                <tr><th className="py-1.5 font-medium">Profil</th><th className="hidden py-1.5 font-medium sm:table-cell">Maße</th><th className="py-1.5 text-right font-medium">Gewicht</th>{anyPrice && <th className="py-1.5 text-right font-medium">Preis</th>}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((p) => {
                  const w = unitWeight(p, material);
                  const kg = pricePerKg(prices, p.family, material);
                  return (
                    <tr key={p.key} onClick={() => pick(p)} className={clsx("cursor-pointer hover:bg-mist", sel?.key === p.key && "bg-brand-soft")}>
                      <td className="py-1.5 pr-2 font-medium">{p.name}{!p.table && STEEL_ONLY.has(p.family) ? <span className="text-xs font-normal text-steel"> ca.</span> : null}</td>
                      <td className="hidden py-1.5 pr-2 text-xs text-steel sm:table-cell">{dimsText(p)}</td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{w.toLocaleString("de-DE")} kg/{p.per}</td>
                      {anyPrice && <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{kg !== null ? `${euro(w * kg)}/${p.per}` : "–"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside ref={calcRef} className="card h-fit min-w-0 space-y-3 p-4 lg:sticky lg:top-4">
        <h2 className="flex items-center gap-2 font-semibold"><Calculator className="size-4 text-brand" /> Rechner</h2>
        {!sel || !calc ? (
          <p className="text-sm text-steel">Links ein Profil antippen.</p>
        ) : (
          <>
            <div>
              <p className="text-lg font-semibold">{sel.name}{calc.material !== "STAHL" ? ` · ${MATERIAL_LABEL[calc.material]}` : ""}</p>
              <p className="text-xs text-steel">{dimsText(sel)} · {calc.unitKg.toLocaleString("de-DE")} kg/{sel.per} {sel.table ? "(Normtabelle)" : "(berechnet, ca.)"}</p>
            </div>
            <div className={clsx("grid gap-2", sel.family === "BL" ? "grid-cols-3" : "grid-cols-2")}>
              <label className="text-xs text-steel">Stück<input inputMode="decimal" value={stueck} onChange={(e) => setStueck(e.target.value)} className="input mt-1 w-full" /></label>
              <label className="text-xs text-steel">Länge (m)<input inputMode="decimal" value={laenge} onChange={(e) => setLaenge(e.target.value)} className="input mt-1 w-full" /></label>
              {sel.family === "BL" && <label className="text-xs text-steel">Breite (m)<input inputMode="decimal" value={breite} onChange={(e) => setBreite(e.target.value)} className="input mt-1 w-full" /></label>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verzinkt} onChange={(e) => setVerzinkt(e.target.checked)} /> feuerverzinkt (Zuschlag)</label>
            <div className="rounded-lg bg-mist p-3">
              <p className="text-xs text-steel">{calc.amount.toLocaleString("de-DE")} {sel.per} gesamt</p>
              <p className="text-2xl font-semibold tabular-nums">{kgText(calc.totalKg)}</p>
              {price ? (
                <p className="mt-1 text-sm">
                  Material ca. <span className="font-semibold">{euro(price.total)}</span> netto
                  <span className="block text-xs text-steel">{price.perKg.toLocaleString("de-DE")} €/kg{verzinkt ? (price.zuschlag === null ? " · Verzinken: kein Zuschlag hinterlegt" : ` + ${price.zuschlag.toLocaleString("de-DE")} €/kg Verzinken`) : ""}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-steel">Kein €/kg-Preis hinterlegt – unten eintragen oder im Lieferanten-Katalog nachsehen.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/lieferanten?q=${encodeURIComponent(sel.name.replace(/^(Flachstahl|Rundstahl|Vierkantstahl|Quadratrohr|Rechteckrohr|Rundrohr|Winkel|Blech) /, "").replace(" mm", ""))}`} className="btn-secondary"><BookOpen className="size-4" /> Lieferantenpreise</Link>
              {canStock && <ActionButton action={addSteelToStock.bind(null, sel.name, material)}><Boxes className="size-4" /> Ins Lager</ActionButton>}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
