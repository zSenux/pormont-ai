"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Loader2 } from "lucide-react";
import { sendReceiptToLexware } from "@/app/actions/work";

export function SendToLexware({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-primary px-3 py-1.5 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await sendReceiptToLexware(id);
            setError(r.ok ? null : (r.error ?? "Fehler."));
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />} In Lexware hochladen
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
