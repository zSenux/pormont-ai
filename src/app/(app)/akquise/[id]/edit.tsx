"use client";

import { StateForm } from "@/components/state-form";
import { updateLead } from "@/app/actions/akquise";

type L = { id: string; name: string; category: string | null; contactName: string | null; email: string | null; phone: string | null; website: string | null; street: string | null; postalCode: string | null; city: string | null; value: number | null; notes: string | null };

export function EditLead({ l }: { l: L }) {
  const f = (name: keyof L, placeholder: string, extra: Record<string, string> = {}) => (
    <label className="text-xs text-steel">
      {placeholder}
      <input name={name} defaultValue={(l[name] as string | number | null) ?? ""} className="input mt-1 w-full" {...extra} />
    </label>
  );
  return (
    <StateForm action={updateLead.bind(null, l.id)} submit="Speichern">
      <div className="grid gap-2 sm:grid-cols-2">
        {f("name", "Firma", { required: "true" })}
        {f("category", "Branche")}
        {f("contactName", "Ansprechpartner")}
        {f("phone", "Telefon", { inputMode: "tel" })}
        {f("email", "E-Mail", { type: "email" })}
        {f("website", "Website")}
        {f("street", "Straße")}
        <div className="grid grid-cols-[6rem_1fr] gap-2">{f("postalCode", "PLZ")}{f("city", "Ort")}</div>
        {f("value", "Auftragswert € (geschätzt)", { inputMode: "numeric" })}
        <label className="text-xs text-steel sm:col-span-2">Notizen<textarea name="notes" defaultValue={l.notes ?? ""} rows={3} className="input mt-1 w-full resize-y" /></label>
      </div>
    </StateForm>
  );
}
