"use client";

import { useMemo } from "react";
import { Rotate3d } from "lucide-react";
import { ModelViewer } from "@/components/vorlagen/viewer";
import { buildModel, type Product } from "@/lib/vorlagen/model";

export function PublicView({ product, params, title }: { product: Product; params: unknown; title: string }) {
  const model = useMemo(() => {
    try {
      return buildModel(product, params);
    } catch {
      return null;
    }
  }, [product, params]);
  if (!model) return <p className="card p-6 text-center text-sm text-steel">Diese Ansicht ist nicht mehr verfügbar.</p>;
  return (
    <>
      <div className="card overflow-hidden p-0">
        <ModelViewer shapes={model.shapes} color={model.color} fitKey={product} className="relative h-[60vh] min-h-80 w-full bg-[#eef2f5]" />
        <p className="flex items-center gap-1 border-t border-line px-4 py-2 text-xs text-steel"><Rotate3d className="size-4" /> Drehen: ziehen · Zoomen: Mausrad bzw. zwei Finger</p>
      </div>
      <section className="card p-4">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <ul className="mt-2 space-y-1 text-sm text-ink/80">{model.specs.map((s) => <li key={s}>· {s}</li>)}</ul>
        <p className="mt-3 text-xs text-steel">Unverbindliche Darstellung zur Veranschaulichung. Maßgeblich sind das Angebot und das gemeinsame Aufmaß vor der Fertigung.</p>
      </section>
    </>
  );
}
