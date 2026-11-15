import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FolderPlus, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { CPV_LABEL, TENDER_STATUS_LABEL, type TenderStatus } from "@/lib/ausschreibungen";
import { saveTenderNote, setTenderStatus, tenderToProject } from "@/app/actions/ausschreibungen";
import { ActionButton } from "@/components/confirm-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausschreibung" };

export default async function AusschreibungDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const t = await db.tender.findUnique({ where: { id: (await params).id } });
  if (!t) notFound();
  const days = t.deadline ? Math.ceil((t.deadline.getTime() - Date.now()) / 86400_000) : null;
  const cpvs = (t.cpv ?? "").split(/[,\s]+/).filter(Boolean);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/ausschreibungen" className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Ausschreibungen</Link>
      <header className="card space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
          <span className="chip shrink-0">{TENDER_STATUS_LABEL[t.status as TenderStatus]}</span>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          {t.buyer && (<><dt className="text-steel">Auftraggeber</dt><dd>{t.buyer}</dd></>)}
          {(t.place || t.postalCode) && (<><dt className="text-steel">Ort</dt><dd>{[t.postalCode, t.place].filter(Boolean).join(" ")}</dd></>)}
          {t.deadline && (<><dt className="text-steel">Angebotsfrist</dt><dd className={clsx(days !== null && days <= 7 && "font-semibold text-bad")}>{formatDateTime(t.deadline)}{days !== null && (days >= 0 ? ` (noch ${days} Tage)` : " (abgelaufen)")}</dd></>)}
          {t.publishedAt && (<><dt className="text-steel">Veröffentlicht</dt><dd>{formatDate(t.publishedAt)}</dd></>)}
          {cpvs.length > 0 && (<><dt className="text-steel">CPV</dt><dd>{cpvs.map((c) => `${c}${CPV_LABEL[c.slice(0, 8)] ? ` (${CPV_LABEL[c.slice(0, 8)]})` : ""}`).join(", ")}</dd></>)}
          <dt className="text-steel">Passung</dt><dd>{t.score} %{t.matched && ` – ${t.matched}`}</dd>
          <dt className="text-steel">Quelle</dt><dd>{t.source === "TED" ? `EU-Amtsblatt (TED), Nr. ${t.externalId}` : t.source === "RSS" ? "RSS-Feed" : "von Hand erfasst"}</dd>
        </dl>
        {t.description && <p className="whitespace-pre-line rounded-xl bg-mist p-3 text-sm">{t.description}</p>}
        <p className="text-xs text-steel">Alle Angaben stammen aus der öffentlichen Bekanntmachung. Vergabeunterlagen und verbindliche Fristen immer dort prüfen.</p>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {t.url && <a href={t.url} target="_blank" rel="noreferrer noopener" className="btn-primary"><ExternalLink className="size-4" /> Bekanntmachung öffnen</a>}
          {t.projectId ? (
            <Link href={`/projekte/${t.projectId}`} className="btn-secondary"><FolderPlus className="size-4" /> Zum Projekt</Link>
          ) : (
            <ActionButton action={tenderToProject.bind(null, t.id)} confirm="Als Projekt (Phase Anfrage) mit Meilenstein Angebotsfrist anlegen?" className="btn-secondary"><FolderPlus className="size-4" /> Angebot vorbereiten</ActionButton>
          )}
          {t.status !== "INTERESSANT" && <ActionButton action={setTenderStatus.bind(null, t.id, "INTERESSANT", undefined)} className="btn-secondary"><ThumbsUp className="size-4" /> Interessant</ActionButton>}
          {t.status !== "ABGELEHNT" && <ActionButton action={setTenderStatus.bind(null, t.id, "ABGELEHNT", undefined)} className="btn-secondary text-steel"><ThumbsDown className="size-4" /> Nicht für uns</ActionButton>}
          <Link href={`/jarvis?q=${encodeURIComponent(`Schau dir die Ausschreibung „${t.title}“ (id ${t.id}) an: Passt sie zu ProMont, was müssten wir liefern, und was ist bis zur Frist zu tun?`)}`} className="btn-secondary"><Sparkles className="size-4" /> Jarvis einschätzen lassen</Link>
        </div>
      </header>
      <form action={saveTenderNote.bind(null, t.id)} className="card space-y-2 p-5">
        <label className="font-semibold" htmlFor="note">Notiz</label>
        <textarea id="note" name="note" rows={3} defaultValue={t.note ?? ""} placeholder="z. B. Unterlagen angefordert, Begehung am …" className="input" />
        <button className="btn-secondary">Speichern</button>
      </form>
    </main>
  );
}
