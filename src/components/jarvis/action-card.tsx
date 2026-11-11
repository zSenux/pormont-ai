"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { approveAction, rejectAction } from "@/app/actions";

export type ActionView = { id: string; kind: string; summary: string; status: "PENDING" | "DONE" | "DECLINED" | "ERROR"; result?: string | null; links?: { label: string; url: string }[] | null };

const TITLE: Record<string, string> = { kunde_anlegen: "Kunde anlegen", rechnung_erstellen: "Rechnung erstellen", angebot_erstellen: "Angebot erstellen" };

/** Freigabe-Karte: erst dieser Klick schreibt in Lexware */
export function ActionCard({ action, onDone }: { action: ActionView; onDone?: (a: ActionView) => void }) {
  const [a, setA] = useState(action);
  const [pending, start] = useTransition();
  const decide = (yes: boolean) =>
    start(async () => {
      if (yes) {
        const r = await approveAction(a.id);
        const next: ActionView = r.ok ? { ...a, status: "DONE", result: r.result, links: r.links } : { ...a, status: "ERROR", result: r.error };
        setA(next);
        onDone?.(next);
      } else {
        await rejectAction(a.id);
        const next: ActionView = { ...a, status: "DECLINED" };
        setA(next);
        onDone?.(next);
      }
    });
  const tone = a.status === "DONE" ? "border-green-200 bg-green-50" : a.status === "ERROR" ? "border-red-200 bg-red-50" : a.status === "DECLINED" ? "border-line bg-mist" : "border-amber-200 bg-amber-50";
  return (
    <div className={`rounded-2xl border p-4 text-sm ${tone}`}>
      <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
        <ShieldCheck className="size-4 text-brand" />
        Freigabe: {TITLE[a.kind] ?? a.kind}
        <span className="ml-auto text-xs font-medium text-steel">
          {a.status === "PENDING" ? "wartet auf dich" : a.status === "DONE" ? "erledigt" : a.status === "DECLINED" ? "abgelehnt" : "Fehler"}
        </span>
      </div>
      <p className="whitespace-pre-line text-ink/80">{a.summary}</p>
      {a.result && a.status !== "PENDING" && <p className={`mt-2 ${a.status === "ERROR" ? "text-bad" : "text-ok"}`}>{a.result}</p>}
      {a.links && a.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5">
              <ExternalLink className="size-3.5" /> {l.label}
            </a>
          ))}
        </div>
      )}
      {a.status === "PENDING" && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary" disabled={pending} onClick={() => decide(true)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Freigeben
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => decide(false)}>
            <X className="size-4" /> Ablehnen
          </button>
        </div>
      )}
    </div>
  );
}
