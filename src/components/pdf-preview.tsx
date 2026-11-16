"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileDown, Loader2 } from "lucide-react";

/**
 * Zeigt ein PDF als Seitenbilder (pdf.js aus unpdf, im Browser).
 * Funktioniert auch auf dem iPhone und in der Windows-App gleich – ein <iframe> zeigt dort oft nur Seite 1.
 * Beim Neuladen bleibt das alte Bild stehen, bis die neuen Seiten fertig sind (kein Flackern).
 */
export function PdfPages({ data, className }: { data: ArrayBuffer | null; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      // in 40-px-Schritten, damit Größenänderungen nicht bei jedem Pixel neu zeichnen
      const w = Math.floor(e.contentRect.width / 40) * 40;
      setWidth((old) => (w > 0 && w !== old ? w : old));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!data || !width || !el) return;
    let cancelled = false;
    (async () => {
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data.slice(0)));
      try {
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const pages: HTMLCanvasElement[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(viewport.width);
          c.height = Math.floor(viewport.height);
          c.style.width = "100%";
          c.setAttribute("role", "img");
          c.setAttribute("aria-label", `Seite ${n} von ${pdf.numPages}`);
          c.className = "block rounded-sm bg-white shadow-[0_1px_4px_rgba(16,24,32,.18)]";
          await page.render({ canvas: c, viewport }).promise;
          if (cancelled) return;
          pages.push(c);
        }
        if (!cancelled) {
          el.replaceChildren(...pages);
          setFailed(null);
        }
      } finally {
        void pdf.loadingTask.destroy();
      }
    })().catch((e) => {
      console.error("PDF-Vorschau", e);
      if (!cancelled) setFailed("Die Vorschau konnte hier nicht gezeichnet werden. Öffne das PDF über den Knopf oben.");
    });
    return () => {
      cancelled = true;
    };
  }, [data, width]);

  return (
    <div className={className}>
      {failed && <p className="mb-2 text-sm text-warn">{failed}</p>}
      <div ref={box} className="space-y-3" />
    </div>
  );
}

/** Lädt ein fertiges PDF (z. B. archivierter Beleg, Lexware-Original) und zeigt es als Vorschau */
export function PdfFromUrl({ url, downloadUrl, title = "PDF-Vorschau" }: { url: string; downloadUrl?: string; title?: string }) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.text().catch(() => "")) || `Fehler ${r.status}`);
        setData(await r.arrayBuffer());
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "PDF konnte nicht geladen werden.");
      });
    return () => ctrl.abort();
  }, [url]);
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="mr-auto font-semibold">{title}</h2>
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary px-2.5 py-1.5 text-xs"><ExternalLink className="size-3.5" /> Öffnen</a>
        {downloadUrl && <a href={downloadUrl} className="btn-secondary px-2.5 py-1.5 text-xs"><FileDown className="size-3.5" /> Herunterladen</a>}
      </div>
      <div className="max-h-[80vh] overflow-y-auto bg-mist p-3 sm:p-4">
        {error ? <p className="text-sm text-steel">{error}</p> : !data ? <p className="flex items-center gap-2 text-sm text-steel"><Loader2 className="size-4 animate-spin" /> PDF wird geladen …</p> : null}
        <PdfPages data={data} className="mx-auto max-w-3xl" />
      </div>
    </section>
  );
}
