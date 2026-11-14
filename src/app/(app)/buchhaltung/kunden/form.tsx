"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { createCustomerAction, updateCustomerAction } from "@/app/actions/buchhaltung";

export type CustomerValues = { id?: string; kind?: string; name?: string; salutation?: string | null; firstName?: string | null; lastName?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string; vatId?: string | null; buyerReference?: string | null; paymentDays?: number | null; notes?: string | null };

export function CustomerForm({ c, back }: { c?: CustomerValues; back?: string }) {
  const [kind, setKind] = useState(c?.kind ?? "FIRMA");
  const action = c?.id ? updateCustomerAction.bind(null, c.id) : createCustomerAction;
  return (
    <StateForm action={action} submit={c?.id ? "Speichern" : <><Plus className="size-4" /> Kunde anlegen</>}>
      {back && <input type="hidden" name="back" value={back} />}
      <div className="flex gap-2">
        {[["FIRMA", "Firma"], ["PERSON", "Privatperson"]].map(([k, l]) => (
          <label key={k} className={`chip cursor-pointer px-3 py-1.5 ${kind === k ? "border-brand bg-brand text-white" : "border-line bg-white text-steel"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />{l}
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {kind === "FIRMA" && <input name="company" required defaultValue={c?.kind === "FIRMA" ? c?.name : ""} placeholder="Firmenname" className="input sm:col-span-2" aria-label="Firmenname" />}
        <select name="salutation" defaultValue={c?.salutation ?? ""} className="input" aria-label="Anrede">
          <option value="">Anrede</option><option>Herr</option><option>Frau</option>
        </select>
        {kind === "FIRMA" ? (
          <input name="contactName" defaultValue={c?.contactName ?? ""} placeholder="Ansprechpartner (Vor- und Nachname)" className="input" aria-label="Ansprechpartner" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input name="firstName" defaultValue={c?.firstName ?? ""} placeholder="Vorname" className="input" aria-label="Vorname" />
            <input name="lastName" required defaultValue={c?.lastName ?? ""} placeholder="Nachname" className="input" aria-label="Nachname" />
          </div>
        )}
        <input name="email" type="email" defaultValue={c?.email ?? ""} placeholder="E-Mail (für Rechnungen)" className="input" aria-label="E-Mail" />
        <input name="phone" defaultValue={c?.phone ?? ""} placeholder="Telefon" className="input" aria-label="Telefon" />
        <input name="street" defaultValue={c?.street ?? ""} placeholder="Straße und Hausnummer" className="input sm:col-span-2" aria-label="Straße" />
        <div className="grid grid-cols-[6rem_1fr_4rem] gap-2 sm:col-span-2">
          <input name="zip" defaultValue={c?.zip ?? ""} placeholder="PLZ" className="input" aria-label="PLZ" />
          <input name="city" defaultValue={c?.city ?? ""} placeholder="Ort" className="input" aria-label="Ort" />
          <input name="country" defaultValue={c?.country ?? "DE"} maxLength={2} className="input uppercase" aria-label="Land (2 Buchstaben)" />
        </div>
        <input name="vatId" defaultValue={c?.vatId ?? ""} placeholder="USt-IdNr. (nötig bei § 13b)" className="input" aria-label="USt-IdNr." />
        <input name="paymentDays" inputMode="numeric" defaultValue={c?.paymentDays ?? ""} placeholder="Zahlungsziel Tage (leer = Standard)" className="input" aria-label="Zahlungsziel" />
        <input name="buyerReference" defaultValue={c?.buyerReference ?? ""} placeholder="Leitweg-ID / Käuferreferenz (nur Behörden)" className="input sm:col-span-2" aria-label="Leitweg-ID" />
        <textarea name="notes" defaultValue={c?.notes ?? ""} rows={2} placeholder="Interne Notizen" className="input resize-y sm:col-span-2" aria-label="Notizen" />
      </div>
    </StateForm>
  );
}
