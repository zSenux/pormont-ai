"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Knopf, der eine Server-Action aufruft (optional mit Rückfrage) */
export function ActionButton({ action, confirm, children, className = "btn-secondary", title }: { action: () => Promise<unknown>; confirm?: string; children: ReactNode; className?: string; title?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={title}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          await action();
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : children}
    </button>
  );
}
