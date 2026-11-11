"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Globe, Loader2, MessageSquareText } from "lucide-react";
import { runLeadTool } from "@/app/actions/akquise";

/** Knöpfe: Website prüfen, Gesprächsleitfaden, Brief – zeigen Fehler direkt an */
export function LeadTools({ id, hasWebsite, ai }: { id: string; hasWebsite: boolean; ai: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const [, start] = useTransition();
  const router = useRouter();
  const run = (what: "check" | "pitch" | "letter") => {
    setBusy(what);
    setMsg(undefined);
    start(async () => {
      const r = await runLeadTool(id, what);
      setMsg(r);
      setBusy(null);
      router.refresh();
    });
  };
  const B = ({ what, icon: I, label, disabled }: { what: "check" | "pitch" | "letter"; icon: typeof Globe; label: string; disabled?: boolean }) => (
    <button type="button" className="btn-secondary" disabled={!!busy || disabled} onClick={() => run(what)}>
      {busy === what ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />} {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <B what="check" icon={Globe} label="Website & Impressum prüfen" disabled={!hasWebsite} />
        <B what="pitch" icon={MessageSquareText} label="Gesprächsleitfaden" disabled={!ai} />
        <B what="letter" icon={FileSignature} label="Brief schreiben" disabled={!ai} />
      </div>
      {busy && busy !== "check" && <p className="text-xs text-steel">Jarvis schreibt … das dauert etwa 20–40 Sekunden.</p>}
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="text-sm text-ok">{msg.ok}</p>}
    </div>
  );
}
