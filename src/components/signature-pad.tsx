"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser, Loader2, PenLine } from "lucide-react";
import { signAction } from "@/app/actions/montage";

/** Digitale Unterschrift des Kunden für die Abnahme (Finger, Stift oder Maus) */
export function SignaturePad({ assemblyId, defaultName }: { assemblyId: string; defaultName?: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [name, setName] = useState(defaultName ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#101820";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  }

  function submit() {
    setMsg(null);
    if (empty) return setMsg("Bitte im Feld unterschreiben.");
    if (name.trim().length < 2) return setMsg("Bitte den Namen des Unterzeichners eintragen.");
    const signature = canvas.current!.toDataURL("image/png");
    start(async () => {
      const r = await signAction(assemblyId, { signerName: name.trim(), signature, note: note.trim() || undefined });
      if (r.error) setMsg(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name des Kunden / Bauleiters" className="input w-full" aria-label="Name des Unterzeichners" />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Vorbehalte / offene Mängel (optional)" className="input w-full resize-y" aria-label="Vorbehalte" />
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
          aria-label="Unterschriftsfeld"
          onPointerDown={(e) => {
            drawing.current = true;
            canvas.current!.setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-steel/60">Hier unterschreiben</span>}
      </div>
      {msg && <p className="text-sm text-bad">{msg}</p>}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={clear} className="btn-secondary"><Eraser className="size-4" /> Löschen</button>
        <button type="button" onClick={submit} disabled={pending} className="btn-primary">{pending ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />} Abnahme bestätigen</button>
      </div>
    </div>
  );
}
