"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={url} className="input min-w-0 flex-1 font-mono text-xs" aria-label="Abo-Link" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        }}
      >
        {ok ? <Check className="size-4" /> : <Copy className="size-4" />} {ok ? "Kopiert" : "Kopieren"}
      </button>
    </div>
  );
}
