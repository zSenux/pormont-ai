"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Knopf für eine Server-Action, die { ok | error } zurückgibt – mit optionaler Rückfrage und Meldung */
export function ResultButton({ action, confirm, children, className = "btn-secondary" }: { action: () => Promise<{ ok?: string; error?: string } | undefined | void>; confirm?: string; children: ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setMsg(r || null);
            router.refresh();
          });
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : children}
      </button>
      {msg?.error && <span className="max-w-xs text-right text-xs text-bad" role="alert">{msg.error}</span>}
      {msg?.ok && <span className="max-w-xs text-right text-xs text-ok">{msg.ok}</span>}
    </span>
  );
}
