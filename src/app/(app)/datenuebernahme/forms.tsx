"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, FileUp, Loader2 } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { setTableKind, startTransfer } from "@/app/actions/datenuebernahme";

const KINDS: [string, string][] = [
  ["kunde", "Kunden"],
  ["artikel", "Artikel/Leistungen"],
  ["rechnung", "Rechnungen"],
  ["angebot", "Angebote"],
  ["projekt", "Projekte"],
  ["sonstiges", "Sonstiges (nur Archiv)"],
];

export function ExportUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  async function send(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch("/api/datenuebernahme", { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string; tables?: { name: string; kind: string; rows: number }[] };
      if (!res.ok) setMsg({ error: j.error ?? "Import fehlgeschlagen." });
      else setMsg({ ok: `Eingelesen: ${(j.tables ?? []).map((t) => `${t.name} (${t.rows} ${t.rows === 1 ? "Zeile" : "Zeilen"}, erkannt als ${KINDS.find(([k]) => k === t.kind)?.[1] ?? t.kind})`).join(", ")}. Bitte unten prüfen.` });
      router.refresh();
    } catch {
      setMsg({ error: "Keine Verbindung – bitte noch einmal." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <label className={`btn-primary w-fit cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        {busy ? "Wird eingelesen …" : "Exportdatei hochladen"}
        <input ref={input} type="file" className="sr-only" accept=".csv,.txt,.tsv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files?.[0])} />
      </label>
      <p className="text-xs text-steel">Excel (.xlsx, alle Blätter), CSV oder JSON, bis 25 MB. Mehrere Dateien nacheinander hochladen geht auch (z. B. kunden.csv, rechnungen.csv).</p>
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="flex items-start gap-1 text-sm text-ok"><Check className="mt-0.5 size-4 shrink-0" /> {msg.ok}</p>}
    </div>
  );
}

export function KindForm({ importId, table, kind }: { importId: string; table: string; kind: string }) {
  return (
    <StateForm action={setTableKind.bind(null, importId, table)} submit="Ändern" submitClass="btn-secondary px-3 py-1.5 text-xs" className="flex flex-wrap items-center gap-2">
      <select name="kind" defaultValue={kind} className="input w-auto py-1.5 text-sm" aria-label={`Art der Tabelle ${table}`}>
        {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </StateForm>
  );
}

export function TransferButton({ importId, what, label, confirm }: { importId: string; what: "kunde" | "artikel" | "projekt"; label: string; confirm: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | undefined>();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-primary px-3 py-1.5 text-sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          start(async () => {
            setMsg(await startTransfer(importId, what));
            router.refresh();
          });
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />} {label}
      </button>
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {msg.ok}</p>}
    </div>
  );
}
