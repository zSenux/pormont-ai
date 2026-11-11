"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { reviewExpense } from "@/app/actions/spesen";

export function ReviewButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (d: "GENEHMIGT" | "ABGELEHNT") => {
    let note: string | undefined;
    if (d === "ABGELEHNT") {
      const n = window.prompt("Grund für die Ablehnung (sieht der Mitarbeiter):");
      if (n === null) return;
      note = n;
    }
    start(async () => {
      await reviewExpense(id, d, note);
      router.refresh();
    });
  };
  return (
    <div className="flex shrink-0 gap-1.5">
      <button type="button" disabled={pending} onClick={() => go("GENEHMIGT")} className="btn-primary px-3 py-1.5" title="Genehmigen" aria-label="Genehmigen">{pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}</button>
      <button type="button" disabled={pending} onClick={() => go("ABGELEHNT")} className="btn-secondary px-3 py-1.5 text-bad" title="Ablehnen" aria-label="Ablehnen"><X className="size-4" /></button>
    </div>
  );
}
