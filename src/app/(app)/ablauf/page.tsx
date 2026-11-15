import { Suspense } from "react";
import { requireUser } from "@/lib/auth/user";
import { AblaufBoard } from "@/components/ablauf/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Arbeitsablauf" };

/** Startbild wie in der gewohnten Warenwirtschaft: Kunde → Angebot → Auftragsbestätigung → Lieferschein → Rechnung, Artikel, Einkauf */
export default async function AblaufPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <Suspense fallback={<div className="h-[560px] animate-pulse rounded-[28px] bg-brand/80" />}>
        <AblaufBoard user={user} />
      </Suspense>
      <p className="mt-4 text-center text-xs text-steel">Zahlen sind live. Auftragsbestätigung und Lieferschein entstehen aus dem Auftrag – der Auftrag kommt automatisch, wenn ein Angebot angenommen wird.</p>
    </main>
  );
}
