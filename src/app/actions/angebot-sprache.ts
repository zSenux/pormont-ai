"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { BookError } from "@/lib/buchhaltung/docs";
import { quoteFromDictation, VoiceQuoteError } from "@/lib/buchhaltung/sprach-angebot";

// Angebot per Sprache: Diktat → Angebots-Entwurf (Bereich Buchhaltung)

export type VoiceQuoteResult = { error?: string; docId?: string; customer?: string | null; customerCreated?: boolean; questions?: string[]; netCents?: number; grossCents?: number; lines?: number };

export async function voiceQuote(text: string, projectId?: string | null): Promise<VoiceQuoteResult> {
  const u = await requireArea("buchhaltung");
  const t = z.string().max(8000).safeParse(text);
  if (!t.success) return { error: "Das Diktat ist zu lang (max. 8.000 Zeichen)." };
  try {
    const r = await quoteFromDictation(t.data, u, { projectId: projectId && z.cuid().safeParse(projectId).success ? projectId : null });
    revalidatePath("/buchhaltung/belege");
    return { docId: r.doc.id, customer: r.customer?.name ?? null, customerCreated: r.customerCreated, questions: r.questions, netCents: r.totals.netCents, grossCents: r.totals.grossCents, lines: r.parsed.positionen.length };
  } catch (e) {
    if (e instanceof VoiceQuoteError || e instanceof BookError) return { error: e.message };
    console.error("[angebot-sprache]", e);
    return { error: "Das hat nicht geklappt – bitte noch einmal versuchen." };
  }
}
