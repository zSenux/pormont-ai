"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { createLead, searchLeads } from "@/app/actions/akquise";
import { TARGETS } from "@/lib/akquise/stages";

export function SearchForm({ configured }: { configured: boolean }) {
  const [query, setQuery] = useState("");
  return (
    <StateForm action={searchLeads} submit={<><Search className="size-4" /> Bei Google suchen</>}>
      <div className="grid grid-cols-[1fr_8.5rem] gap-2">
        <input name="query" value={query} onChange={(e) => setQuery(e.target.value)} required placeholder="Branche, z. B. Bauunternehmen" className="input" aria-label="Branche" />
        <input name="location" required defaultValue="Mannheim" placeholder="Ort" className="input" aria-label="Ort" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TARGETS.map((t) => (
          <button key={t.query} type="button" title={t.why} onClick={() => setQuery(t.query)} className={`chip px-2.5 py-1 text-xs ${query === t.query ? "border-brand bg-brand text-white" : "bg-white text-steel hover:border-brand"}`}>
            {t.query}
          </button>
        ))}
      </div>
      {!configured && <p className="text-xs text-warn">Google-Schlüssel fehlt – ein Administrator trägt ihn unter Einstellungen → Verbindungen ein.</p>}
    </StateForm>
  );
}

export function NewLeadForm() {
  return (
    <StateForm action={createLead} submit={<><UserPlus className="size-4" /> Anlegen</>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" required minLength={2} placeholder="Firma" className="input sm:col-span-2" aria-label="Firma" />
        <input name="category" placeholder="Branche" className="input" aria-label="Branche" />
        <input name="contactName" placeholder="Ansprechpartner" className="input" aria-label="Ansprechpartner" />
        <input name="phone" placeholder="Telefon" className="input" aria-label="Telefon" />
        <input name="email" type="email" placeholder="E-Mail" className="input" aria-label="E-Mail" />
        <input name="website" placeholder="Website" className="input" aria-label="Website" />
        <input name="city" placeholder="Ort" className="input" aria-label="Ort" />
        <select name="source" className="input" aria-label="Herkunft" defaultValue="MANUELL">
          <option value="MANUELL">Eigene Recherche</option>
          <option value="EMPFEHLUNG">Empfehlung</option>
          <option value="ANFRAGE">Anfrage vom Kunden</option>
        </select>
        <input name="value" inputMode="numeric" placeholder="Auftragswert € (geschätzt)" className="input" aria-label="Auftragswert" />
      </div>
    </StateForm>
  );
}
