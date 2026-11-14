"use client";

import { useState } from "react";
import { StateForm } from "@/components/state-form";
import { createPurchaseAction, updatePurchaseAction } from "@/app/actions/ausgaben";

export type PurchaseFormValues = {
  supplier: string;
  docNo: string;
  date: string;
  dueDate: string;
  category: string;
  gross: string;
  tax: string;
  taxRate: 19 | 7 | 0;
  projectId: string;
  fileId: string;
  paid: boolean;
  payMethod: string;
  note: string;
};

const de = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (s: string) => {
  const t = s.replace(/\s|€/g, "");
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
};

export function PurchaseForm({ id, v, categories, payMethods, projects, suppliers }: { id?: string; v: PurchaseFormValues; categories: Record<string, string>; payMethods: Record<string, string>; projects: { id: string; name: string }[]; suppliers: string[] }) {
  const [gross, setGross] = useState(v.gross);
  const [rate, setRate] = useState<19 | 7 | 0>(v.taxRate);
  const [tax, setTax] = useState(v.tax);
  const [paid, setPaid] = useState(v.paid);
  const g = parse(gross);
  const suggested = Number.isFinite(g) ? Math.round((g * rate) / (100 + rate) * 100) / 100 : null;
  const t = tax.trim() ? parse(tax) : suggested;
  const action = id ? updatePurchaseAction.bind(null, id) : createPurchaseAction;
  return (
    <StateForm action={action} submit={id ? "Speichern" : "Ausgabe buchen"} className="space-y-4">
      <input type="hidden" name="fileId" value={v.fileId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Lieferant</span>
          <input name="supplier" defaultValue={v.supplier} required maxLength={200} list="lieferanten" className="input" placeholder="z. B. Würth, Stahlhandel Mannheim" />
          <datalist id="lieferanten">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="block"><span className="label">Belegdatum</span><input name="date" type="date" defaultValue={v.date} required className="input" /></label>
        <label className="block"><span className="label">Rechnungsnr. des Lieferanten</span><input name="docNo" defaultValue={v.docNo} maxLength={100} className="input" /></label>
        <label className="block"><span className="label">Kategorie</span>
          <select name="category" defaultValue={v.category} className="input">{Object.entries(categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="block"><span className="label">Projekt (optional)</span>
          <select name="projectId" defaultValue={v.projectId} className="input"><option value="">– kein Projekt –</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label className="block"><span className="label">Betrag brutto €</span><input name="gross" value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" required className="input" placeholder="z. B. 119,00" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label">USt.-Satz</span>
            <select name="taxRate" value={rate} onChange={(e) => setRate(Number(e.target.value) as 19 | 7 | 0)} className="input"><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></select>
          </label>
          <label className="block"><span className="label">USt. €</span><input name="tax" value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" className="input" placeholder={suggested !== null ? de(suggested) : ""} /></label>
        </div>
        <p className="text-xs text-steel sm:col-span-2">
          {Number.isFinite(g) && t !== null && Number.isFinite(t) ? <>Netto <strong>{de(g - t)} €</strong> · Vorsteuer <strong>{de(t)} €</strong>. </> : null}
          USt. leer lassen = wird aus dem Satz berechnet. Bei gemischten Sätzen die Summe der USt. eintragen.
        </p>
        <label className="block"><span className="label">Fällig am (optional)</span><input name="dueDate" type="date" defaultValue={v.dueDate} className="input" /></label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> schon bezahlt</label>
          {paid && <select name="payMethod" defaultValue={v.payMethod || "UEBERWEISUNG"} className="input">{Object.entries(payMethods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        </div>
        <label className="block sm:col-span-2"><span className="label">Notiz</span><input name="note" defaultValue={v.note} maxLength={1000} className="input" /></label>
      </div>
    </StateForm>
  );
}
