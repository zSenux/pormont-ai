"use client";

import { useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";

// Hinweis oben in der App, solange Klaic Media Jarvis nicht freigeschaltet hat (ansehen geht, benutzen nicht).
// ?gesperrt=1 setzt requireUser(), wenn eine Aktion wegen fehlender Freischaltung abgelehnt wurde.
export function LicenseBanner({ tone, text, kontakt }: { tone: "info" | "bad"; text: string; kontakt: string | null }) {
  const blocked = useSearchParams().get("gesperrt") === "1";
  const color = tone === "bad" ? "border-red-200 bg-red-50 text-red-900" : "border-brand/20 bg-brand-soft text-brand-2";
  return (
    <div role="status" className={`sticky top-0 z-40 border-b px-4 py-2.5 text-sm ${color} ${blocked ? "font-semibold" : ""}`}>
      <div className="mx-auto flex max-w-6xl items-start gap-2">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
        <p>
          {blocked && <span className="block">Das geht erst nach der Freischaltung.</span>}
          {text}
          {kontakt && <span className="opacity-80"> Klaic Media: {kontakt}</span>}
        </p>
      </div>
    </div>
  );
}
