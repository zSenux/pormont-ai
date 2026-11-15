"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Camera, Check, Copy, ExternalLink } from "lucide-react";
import { saveConfigImageAction } from "@/app/actions/vorlagen";
import { buildModel, type Product } from "@/lib/vorlagen/model";
import { ModelViewer, type ViewerHandle } from "./viewer";

// 3D-Ansicht unter einem Angebot aus einer Angebotsvorlage: Kunden-Link, Ansicht fürs PDF übernehmen.
// Fehlt das Bild (z. B. Angebot von Jarvis), wird es beim ersten Öffnen des Entwurfs automatisch gespeichert.

export type DocConfig = { id: string; title: string; product: Product; params: unknown; token: string; hasImage: boolean };

export function DocConfigPanel({ config, draft, origin }: { config: DocConfig; draft: boolean; origin: string }) {
  const model = useMemo(() => {
    try {
      return buildModel(config.product, config.params);
    } catch {
      return null;
    }
  }, [config.product, config.params]);
  const viewer = useRef<ViewerHandle>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const auto = useRef(config.hasImage || !draft);
  const link = `${origin}/3d/${config.token}`;

  const save = useCallback(async (silent = false) => {
    const img = viewer.current?.capture();
    if (!img) return;
    const r = await saveConfigImageAction(config.id, img);
    if (!silent) setMsg(r.error ?? "Ansicht fürs PDF übernommen.");
  }, [config.id]);

  const ready = useCallback(() => {
    if (auto.current) return;
    auto.current = true;
    setTimeout(() => void save(true), 300);
  }, [save]);

  if (!model) return null;
  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 font-semibold"><Box className="size-4 text-brand" /> 3D-Ansicht: {config.title}</h2>
        <span className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Kunden-Link kopieren</button>
          <a href={link} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-1.5 text-xs"><ExternalLink className="size-3.5" /> Öffnen</a>
          {draft && <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void save()}><Camera className="size-3.5" /> Diese Ansicht ins PDF</button>}
        </span>
      </div>
      <ModelViewer ref={viewer} shapes={model.shapes} color={model.color} fitKey={config.id} onReady={ready} className="relative mt-3 h-64 w-full bg-[#eef2f5] sm:h-80" />
      <p className="border-t border-line px-4 py-2 text-xs text-steel">{msg ?? (draft ? "Das Bild kommt als eigene Seite ins Angebots-PDF, mit Link zur interaktiven Ansicht (ohne Preise). Ansicht drehen und „Diese Ansicht ins PDF“ tippen, um das Bild zu ändern." : "Das Bild ist im festgeschriebenen PDF enthalten. Der Kunden-Link zeigt das Modell ohne Preise.")}</p>
    </section>
  );
}
