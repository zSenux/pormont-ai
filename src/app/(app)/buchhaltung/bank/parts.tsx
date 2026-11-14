"use client";

import { useState } from "react";
import { StateForm } from "@/components/state-form";
import { assignTxAction, autoAssignAction, importStatementAction } from "@/app/actions/bank";
import { ResultButton } from "../beleg/[id]/panels";

export function UploadForm() {
  return (
    <StateForm action={importStatementAction} submit="Kontoauszug einlesen" reset className="space-y-2">
      <input name="datei" type="file" accept=".xml,.csv,.txt,text/csv,application/xml,text/xml" required className="input" aria-label="Kontoauszug" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto" defaultChecked /> Sichere Treffer gleich zuordnen</label>
    </StateForm>
  );
}

export function AutoButton() {
  return <ResultButton action={autoAssignAction}>Alle sicheren Treffer zuordnen</ResultButton>;
}

type Opt = { kind: "doc" | "purchase"; id: string; label: string };

/** Zuordnung von Hand: offene Rechnung (Eingang) bzw. offene Ausgabe (Ausgang) wählen */
export function ManualAssign({ txId, options }: { txId: string; options: Opt[] }) {
  const [sel, setSel] = useState("");
  if (!options.length) return null;
  const pick = options.find((o) => `${o.kind}:${o.id}` === sel);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="input w-auto max-w-64 py-1 text-xs" aria-label="Zuordnen zu">
        <option value="">Zuordnen zu …</option>
        {options.map((o) => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.label}</option>)}
      </select>
      {pick && <ResultButton action={() => assignTxAction(txId, pick.kind, pick.id)} className="btn-secondary px-3 py-1 text-xs">Zuordnen</ResultButton>}
    </span>
  );
}
