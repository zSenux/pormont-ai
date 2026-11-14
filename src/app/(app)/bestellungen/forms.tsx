"use client";

import { useActionState } from "react";
import { Loader2, PackageCheck, Send } from "lucide-react";
import { newSupplierOrder, receiveAction } from "@/app/actions/bestellungen";
import { fmtNum, openQty, type BeLine } from "@/lib/bestellungen-shared";

function Msg({ s }: { s?: { ok?: string; error?: string } }) {
  if (s?.error) return <p className="text-sm text-bad" role="alert">{s.error}</p>;
  if (s?.ok) return <p className="text-sm text-ok">{s.ok}</p>;
  return null;
}

export function NewOrderForm({ suppliers, projects, projectId }: { suppliers: { id: string; name: string }[]; projects: { id: string; name: string }[]; projectId?: string }) {
  const [state, action, pending] = useActionState(newSupplierOrder, undefined);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <select name="supplierId" required className="input" aria-label="Lieferant" defaultValue="">
        <option value="" disabled>Lieferant wählen …</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select name="projectId" className="input" aria-label="Projekt" defaultValue={projectId ?? ""}>
        <option value="">für das Lager (kein Projekt)</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <textarea name="positions" required rows={5} className="input resize-y sm:col-span-2" aria-label="Positionen" placeholder={"Eine Zeile je Position, Preis optional mit „à“:\n12 Stk Rohr 40×40×3 S235 6 m à 18,40\n6 Stk HEA 200 S235JR 6 m\n2 Pak Schweißdraht SG2 1,0 mm"} />
      <label className="text-xs text-steel">Liefertermin <input name="expectedAt" type="date" className="input mt-1 w-full" /></label>
      <label className="text-xs text-steel">Auftragsbestätigung/Bestell-Nr. Lieferant <input name="supplierRef" className="input mt-1 w-full" /></label>
      <input name="note" placeholder="Hinweis (z. B. Anlieferung Werkstatt, Zuschnitt)" className="input sm:col-span-2" aria-label="Hinweis" />
      <div className="space-y-2 sm:col-span-2">
        <Msg s={state} />
        <button className="btn-primary" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Bestellung anlegen</button>
      </div>
    </form>
  );
}

export function ReceiveForm({ orderId, lines, stock }: { orderId: string; lines: BeLine[]; stock: { id: string; name: string; unit: string }[] }) {
  const [state, action, pending] = useActionState(receiveAction.bind(null, orderId), undefined);
  return (
    <form action={action} className="space-y-3">
      <ul className="divide-y divide-line">
        {lines.map((l, i) =>
          openQty(l) > 0 ? (
            <li key={i} className="grid gap-2 py-2 text-sm sm:grid-cols-[1fr_7rem_14rem] sm:items-center">
              <span><strong>{l.text}</strong><span className="block text-xs text-steel">offen {fmtNum(openQty(l))} {l.unit ?? ""} von {fmtNum(l.qty)}</span></span>
              <input name={`qty_${i}`} inputMode="decimal" defaultValue={String(openQty(l)).replace(".", ",")} className="input" aria-label={`Gelieferte Menge Position ${i + 1}`} />
              <select name={`stock_${i}`} defaultValue={l.stockItemId ?? ""} className="input text-xs" aria-label={`Lagerartikel Position ${i + 1}`}>
                <option value="">nicht ins Lager (direkt Baustelle)</option>
                {stock.map((s) => <option key={s.id} value={s.id}>ins Lager: {s.name}</option>)}
              </select>
            </li>
          ) : null,
        )}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="slipNo" placeholder="Lieferschein-Nr." className="input" aria-label="Lieferschein-Nummer" />
        <label className="input flex cursor-pointer items-center gap-2 text-sm text-steel">Foto Lieferschein <input name="photo" type="file" accept="image/*,application/pdf" capture="environment" className="min-w-0 text-xs" /></label>
        <input name="note" placeholder="Bemerkung (z. B. 1 Stange beschädigt)" className="input sm:col-span-2" aria-label="Bemerkung" />
      </div>
      <Msg s={state} />
      <button className="btn-primary" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Wareneingang buchen</button>
      <p className="text-xs text-steel">Menge leer lassen oder 0 = nicht geliefert. Lagerartikel bekommen den Zugang mit dem Bestellpreis.</p>
    </form>
  );
}
