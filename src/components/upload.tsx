"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Upload } from "lucide-react";

// Hochladen von Dokumenten, Baustellenfotos und Belegen. Fotos werden im Browser verkleinert
// (max. 2000 px, JPEG) – spart Speicher und Lexware nimmt Belege nur bis 5 MB.

export async function shrink(file: File, max = 2000): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function Uploader({
  kind,
  projectId,
  label,
  camera = false,
  accept,
  multiple = true,
  withNote = false,
  hint,
  assemblyId,
  phase,
}: {
  kind: "dokument" | "foto" | "beleg";
  projectId?: string;
  label: string;
  camera?: boolean;
  accept?: string;
  multiple?: boolean;
  withNote?: boolean;
  hint?: string;
  /** Montage-Foto: Montage-ID und vorher/nachher */
  assemblyId?: string;
  phase?: "vorher" | "nachher";
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(list: FileList | null) {
    if ((!list || !list.length) && !(withNote && note.trim())) return;
    setError(null);
    setBusy(kind === "beleg" ? "Jarvis liest den Beleg …" : "Wird hochgeladen …");
    try {
      const form = new FormData();
      form.set("kind", kind);
      if (projectId) form.set("projectId", projectId);
      if (assemblyId) form.set("assemblyId", assemblyId);
      if (phase) form.set("phase", phase);
      if (withNote && note.trim()) form.set("note", note.trim());
      for (const f of Array.from(list ?? [])) form.append("files", await shrink(f));
      const res = await fetch("/api/dateien", { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error ?? "Hochladen fehlgeschlagen.");
      else setNote("");
      router.refresh();
    } catch {
      setError("Keine Verbindung – bitte noch einmal.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {withNote && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Notiz (optional) – z. B. „Geländer montiert, Abnahme Freitag“" className="input w-full resize-y" aria-label="Notiz" />}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`btn-primary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : camera ? <Camera className="size-4" /> : <Upload className="size-4" />}
          {busy ?? label}
          <input
            ref={input}
            type="file"
            className="sr-only"
            multiple={multiple}
            accept={accept ?? (kind === "dokument" ? "application/pdf,image/*,text/plain,.csv,.md" : "image/*,application/pdf")}
            {...(camera ? { capture: "environment" as const } : {})}
            onChange={(e) => send(e.target.files)}
          />
        </label>
        {withNote && (
          <button type="button" className="btn-secondary" disabled={!!busy || !note.trim()} onClick={() => send(null)}>
            Nur Notiz speichern
          </button>
        )}
        {hint && <span className="text-xs text-steel">{hint}</span>}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
