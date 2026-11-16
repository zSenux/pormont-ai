"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, FileStack, FileUp, Loader2 } from "lucide-react";
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
        <input ref={input} type="file" className="sr-only" accept=".csv,.txt,.tsv,.asc,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files?.[0])} />
      </label>
      <p className="text-xs text-steel">Excel (.xlsx, alle Blätter), CSV oder JSON, bis 25 MB. Mehrere Dateien nacheinander hochladen geht auch (z. B. kunden.csv, rechnungen.csv).</p>
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="flex items-start gap-1 text-sm text-ok"><Check className="mt-0.5 size-4 shrink-0" /> {msg.ok}</p>}
    </div>
  );
}

/** Viele Beleg-PDFs auf einmal: werden einzeln nacheinander hochgeladen (Fortschritt sichtbar, keine Riesen-Anfrage) */
export function PdfUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ done: number; total: number; matched: number; dup: number; errors: string[] } | null>(null);
  const busy = Boolean(state && state.done < state.total);
  async function send(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const s = { done: 0, total: files.length, matched: 0, dup: 0, errors: [] as string[] };
    setState({ ...s });
    let importId: string | null = null;
    for (const f of files) {
      try {
        const form = new FormData();
        form.set("file", f);
        if (importId) form.set("importId", importId);
        const res = await fetch("/api/datenuebernahme/pdf", { method: "POST", body: form });
        const j = (await res.json().catch(() => ({}))) as { error?: string; importId?: string; duplicate?: boolean; matched?: { label: string } | null };
        if (!res.ok) s.errors.push(`${f.name}: ${j.error ?? "Fehler"}`);
        else {
          importId = j.importId ?? importId;
          if (j.duplicate) s.dup++;
          else if (j.matched) s.matched++;
        }
      } catch {
        s.errors.push(`${f.name}: keine Verbindung`);
      }
      s.done++;
      setState({ ...s, errors: [...s.errors] });
    }
    if (input.current) input.current.value = "";
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <label className={`btn-secondary w-fit cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileStack className="size-4" />}
        {busy ? `PDF ${state!.done + 1} von ${state!.total} …` : "Beleg-PDFs hochladen"}
        <input ref={input} type="file" multiple className="sr-only" accept=".pdf,application/pdf" onChange={(e) => send(e.target.files)} />
      </label>
      <p className="text-xs text-steel">Mehrere PDFs auf einmal markieren, je bis 15 MB. Steht die Belegnummer im Dateinamen (z. B. „Rechnung 10234.pdf“), hängt das PDF an der passenden Rechnung bzw. dem Angebot.</p>
      {state && !busy && (
        <p className="flex items-start gap-1 text-sm text-ok"><Check className="mt-0.5 size-4 shrink-0" /> {state.total - state.errors.length - state.dup} PDFs gespeichert, davon {state.matched} einem Beleg zugeordnet{state.dup ? ` · ${state.dup} waren schon da` : ""}.</p>
      )}
      {state && state.errors.length > 0 && <p className="text-sm text-bad [overflow-wrap:anywhere]" role="alert">{state.errors.slice(0, 5).join(" · ")}{state.errors.length > 5 ? ` … (${state.errors.length} Fehler)` : ""}</p>}
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

export function TransferButton({ importId, what, label, confirm }: { importId: string; what: "kunde" | "artikel" | "projekt" | "rechnung"; label: string; confirm: string }) {
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
