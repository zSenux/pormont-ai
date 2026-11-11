"use client";

import { useState, useTransition } from "react";
import { Loader2, PackageMinus, PackagePlus, Plus, RotateCcw, Send } from "lucide-react";
import { clsx } from "clsx";
import { StateForm } from "@/components/state-form";
import { bookStockAction, createStockItem, reorderStock, updateStockItem } from "@/app/actions/lager";

const CATS: [string, string][] = [
  ["PROFIL", "Träger & Profile"],
  ["ROHR", "Rohre"],
  ["BLECH", "Bleche"],
  ["FLACH_RUND", "Flach-, Rund-, Vierkantstahl"],
  ["SCHRAUBEN", "Schrauben & Dübel"],
  ["BESCHLAG", "Beschläge & Schlosserteile"],
  ["VERBRAUCH", "Verbrauch (Gas, Draht, Scheiben)"],
  ["SONSTIGES", "Sonstiges"],
];
const de = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

type Item = { id: string; name: string; category: string; material: string | null; unit: string; minQuantity: number | null; reorderQty: number | null; price: number | null; location: string | null; supplierId: string | null; articleNo: string | null; notes: string | null };

export function StockItemForm({ item, suppliers }: { item?: Item; suppliers: { id: string; name: string }[] }) {
  const action = item ? updateStockItem.bind(null, item.id) : createStockItem;
  return (
    <StateForm action={action} submit={item ? "Speichern" : <><Plus className="size-4" /> Anlegen</>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" required minLength={2} defaultValue={item?.name ?? ""} placeholder="Bezeichnung, z. B. Flachstahl 50x8" className="input sm:col-span-2" aria-label="Bezeichnung" />
        <select name="category" defaultValue={item?.category ?? "PROFIL"} className="input" aria-label="Gruppe">
          {CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input name="material" defaultValue={item?.material ?? ""} placeholder="Material/Güte, z. B. S235JR" className="input" aria-label="Material" />
        <select name="unit" defaultValue={item?.unit ?? "Stk"} className="input" aria-label="Einheit">
          {["Stk", "m", "kg", "Tafel", "Stange", "Pck", "l", "Fl."].map((u) => <option key={u}>{u}</option>)}
        </select>
        {!item && <input name="quantity" inputMode="decimal" placeholder="Anfangsbestand" className="input" aria-label="Anfangsbestand" />}
        <input name="minQuantity" inputMode="decimal" defaultValue={de(item?.minQuantity)} placeholder="Mindestbestand" className="input" aria-label="Mindestbestand" />
        <input name="reorderQty" inputMode="decimal" defaultValue={de(item?.reorderQty)} placeholder="Nachbestellmenge" className="input" aria-label="Nachbestellmenge" />
        <input name="price" inputMode="decimal" defaultValue={de(item?.price)} placeholder="EK netto je Einheit (€)" className="input" aria-label="Einkaufspreis" />
        <input name="location" defaultValue={item?.location ?? ""} placeholder="Lagerort, z. B. Regal A3" className="input" aria-label="Lagerort" />
        <select name="supplierId" defaultValue={item?.supplierId ?? ""} className="input" aria-label="Lieferant">
          <option value="">Lieferant: –</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input name="articleNo" defaultValue={item?.articleNo ?? ""} placeholder="Artikelnummer beim Lieferanten" className="input" aria-label="Artikelnummer" />
        <textarea name="notes" defaultValue={item?.notes ?? ""} rows={2} placeholder="Notiz" className="input resize-y sm:col-span-2" aria-label="Notiz" />
      </div>
    </StateForm>
  );
}

export function BookForm({ itemId, unit, price, projects }: { itemId: string; unit: string; price: number | null; projects: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<"AUSGANG" | "EINGANG" | "INVENTUR">("AUSGANG");
  const tabs = [
    { k: "AUSGANG" as const, l: "Entnahme", i: PackageMinus },
    { k: "EINGANG" as const, l: "Eingang", i: PackagePlus },
    { k: "INVENTUR" as const, l: "Inventur", i: RotateCcw },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setKind(t.k)} className={clsx("chip px-3 py-1.5", kind === t.k ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
            <t.i className="size-4" /> {t.l}
          </button>
        ))}
      </div>
      <StateForm action={bookStockAction.bind(null, itemId)} submit="Buchen" reset key={kind}>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input name="qty" required inputMode="decimal" placeholder={kind === "INVENTUR" ? "gezählter Bestand" : "Menge"} className="input min-w-0 flex-1" aria-label="Menge" />
            <span className="text-sm text-steel">{unit}</span>
          </label>
          {kind === "AUSGANG" && (
            <select name="projectId" className="input" aria-label="Projekt" defaultValue="">
              <option value="">Ohne Projekt (Werkstatt)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {kind === "EINGANG" && <input name="price" inputMode="decimal" defaultValue={price !== null ? String(price).replace(".", ",") : ""} placeholder="EK netto je Einheit (€)" className="input" aria-label="Einkaufspreis" />}
          <input name="note" placeholder={kind === "EINGANG" ? "Lieferschein-Nr. (optional)" : "Notiz (optional)"} className="input sm:col-span-2" aria-label="Notiz" />
        </div>
      </StateForm>
    </div>
  );
}

export function ReorderButton({ itemId, className = "btn-secondary" }: { itemId: string; className?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className} disabled={pending} onClick={() => start(async () => setError((await reorderStock(itemId))?.error ?? null))}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Nachbestellen
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
