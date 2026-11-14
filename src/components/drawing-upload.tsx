"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { DRAWING_KINDS, DRAWING_KIND_LABEL } from "@/lib/drawings-shared";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.dxf,.dwg,.step,.stp,.ifc";

/** Neue Zeichnung zu einem Projekt oder neuer Index einer Zeichnung hochladen */
export function DrawingUpload({ projectId, drawingId, nextIndex }: { projectId?: string; drawingId?: string; nextIndex?: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      if (projectId) fd.set("projectId", projectId);
      if (drawingId) fd.set("drawingId", drawingId);
      const r = await fetch("/api/zeichnungen", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!r.ok) throw new Error(j.error ?? "Upload fehlgeschlagen.");
      form.current?.reset();
      if (projectId && j.id) router.push(`/zeichnungen/${j.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
      {!drawingId && (
        <>
          <input name="title" required minLength={2} placeholder="z. B. Treppe Achse 3 – Werkplan Blatt 1" className="input sm:col-span-2" aria-label="Titel der Zeichnung" />
          <select name="kind" className="input" aria-label="Art" defaultValue="WERKPLAN">
            {DRAWING_KINDS.map((k) => <option key={k} value={k}>{DRAWING_KIND_LABEL[k]}</option>)}
          </select>
        </>
      )}
      <input name="note" placeholder={drawingId ? `Was ist neu in Index ${nextIndex ?? ""}?` : "Bemerkung (optional)"} className="input" aria-label="Bemerkung" required={Boolean(drawingId)} />
      <input name="file" type="file" required accept={ACCEPT} className="input sm:col-span-2 file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-brand" aria-label="Datei (PDF, Bild, DXF, DWG, STEP)" />
      {error && <p className="text-sm text-bad sm:col-span-2" role="alert">{error}</p>}
      <button className="btn-primary justify-self-start" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {drawingId ? `Index ${nextIndex ?? ""} hochladen` : "Zeichnung hochladen"}</button>
    </form>
  );
}
