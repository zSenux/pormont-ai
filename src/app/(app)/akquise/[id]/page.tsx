import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Mail, MapPin, Phone, Printer, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinParts, formatDate, formatDateTime, todayYmd } from "@/lib/berlin";
import { ACTIVITY_LABEL, STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/akquise/stages";
import { addLeadActivity, deleteLead, setEmailConsent, setFollowUp, setLeadStage } from "@/app/actions/akquise";
import { ActionButton } from "@/components/confirm-button";
import { Markdown } from "@/components/markdown";
import { LeadTools } from "./tools";
import { EditLead } from "./edit";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const l = await db.lead.findUnique({ where: { id: id.data }, include: { activities: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!l) notFound();
  const tel = l.phone?.replace(/[^\d+]/g, "");
  const followUp = l.nextFollowUpAt ? berlinParts(l.nextFollowUpAt).ymd : "";
  const followUpAction = async (form: FormData) => {
    "use server";
    const d = String(form.get("day") ?? "");
    await setFollowUp(l.id, d || null);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/akquise" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Akquise</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{l.name}</h1>
          <p className="mt-1 text-sm text-steel">{[l.category, l.contactName, [l.postalCode, l.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={clsx("chip px-3 py-1", STAGE_TONE[l.stage])}>{STAGE_LABEL[l.stage]}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {tel && <a href={`tel:${tel}`} className="btn-primary"><Phone className="size-4" /> Anrufen</a>}
        {l.website && <a href={l.website} target="_blank" rel="noreferrer" className="btn-secondary"><Globe className="size-4" /> Website</a>}
        {l.mapsUrl && <a href={l.mapsUrl} target="_blank" rel="noreferrer" className="btn-secondary"><MapPin className="size-4" /> Google Maps</a>}
        {l.email && l.emailConsentAt && <a href={`/jarvis?neu=1&q=${encodeURIComponent(`Ich will eine E-Mail an ${l.name} (${l.email}) schreiben, Einwilligung liegt vor. Frag mich kurz, worum es gehen soll, dann mach einen Entwurf.`)}`} className="btn-secondary"><Mail className="size-4" /> E-Mail mit Jarvis</a>}
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">Stufe</h2>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <ActionButton key={s} action={setLeadStage.bind(null, l.id, s)} className={clsx("chip px-3 py-1", l.stage === s ? STAGE_TONE[s] + " ring-2 ring-brand/30" : "bg-white text-steel hover:border-brand")}>
              {STAGE_LABEL[s]}
            </ActionButton>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-5">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Kontakt festhalten</h2>
            <form action={addLeadActivity.bind(null, l.id)} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select name="kind" className="input w-auto" aria-label="Art" defaultValue="ANRUF">
                  {["ANRUF", "TERMIN", "BRIEF", "MAIL", "NOTIZ"].map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-steel">Nachfassen am<input type="date" name="followUp" min={todayYmd()} defaultValue={addDaysYmd(todayYmd(), 7)} className="input w-auto" /></label>
              </div>
              <textarea name="text" required rows={2} placeholder="z. B. „Mit Herrn Weber gesprochen, braucht Geländer für 3 MFH, Plan kommt per Post“" className="input w-full resize-y" aria-label="Notiz" />
              <button className="btn-primary">Speichern</button>
            </form>
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Jarvis hilft</h2>
            <LeadTools id={l.id} hasWebsite={Boolean(l.website)} ai={Boolean(process.env.ANTHROPIC_API_KEY)} />
            {l.checkedAt && <p className="whitespace-pre-line text-sm text-steel">{l.checkNote?.split("\n\nStartseite")[0]} <span className="text-xs">({formatDateTime(l.checkedAt)})</span></p>}
          </section>

          {l.pitch && (
            <details className="card p-4" open>
              <summary className="cursor-pointer font-semibold">Gesprächsleitfaden</summary>
              <div className="prose-sm mt-3 [overflow-wrap:anywhere]"><Markdown text={l.pitch} /></div>
            </details>
          )}
          {l.letter && (
            <details className="card p-4">
              <summary className="cursor-pointer font-semibold">Brief</summary>
              <p className="mt-3 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{l.letter}</p>
              <Link href={`/akquise/${l.id}/brief`} className="btn-secondary mt-3 w-fit"><Printer className="size-4" /> Drucken</Link>
            </details>
          )}

          <section className="card p-4">
            <h2 className="font-semibold">Verlauf</h2>
            <ul className="mt-2 space-y-3">
              {l.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="text-xs text-steel">{formatDateTime(a.createdAt)} · {ACTIVITY_LABEL[a.kind] ?? a.kind}{a.userName ? ` · ${a.userName}` : ""}</span>
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">{a.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="card space-y-2 p-4">
            <h2 className="font-semibold">Nachfassen</h2>
            <form action={followUpAction} className="flex flex-wrap gap-2">
              <input type="date" name="day" defaultValue={followUp} className="input w-auto" aria-label="Datum" />
              <button className="btn-secondary">Setzen</button>
            </form>
            <p className="text-xs text-steel">{l.nextFollowUpAt ? `Erscheint am ${formatDate(l.nextFollowUpAt)} unter „Heute nachfassen“.` : "Kein Termin gesetzt."}</p>
          </section>

          <section className="card space-y-2 p-4">
            <h2 className="font-semibold">E-Mail-Einwilligung</h2>
            <p className="text-xs text-steel">Werbe-Mails nur, wenn die Firma zugestimmt oder selbst angefragt hat (§ 7 UWG).</p>
            {l.emailConsentAt ? (
              <>
                <p className="text-sm text-ok">Erteilt am {formatDate(l.emailConsentAt)}</p>
                <ActionButton action={setEmailConsent.bind(null, l.id, false)} className="text-xs text-bad hover:underline">Zurücknehmen</ActionButton>
              </>
            ) : (
              <ActionButton action={setEmailConsent.bind(null, l.id, true)} confirm="Hat die Firma ausdrücklich zugestimmt oder selbst angefragt?">Einwilligung liegt vor</ActionButton>
            )}
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Daten bearbeiten</summary>
            <div className="mt-3"><EditLead l={l} /></div>
          </details>

          {l.rating !== null && <p className="px-1 text-xs text-steel">Google: {l.rating} ★ ({l.reviews ?? 0} Bewertungen){l.mapsUrl && <> · <a href={l.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand">Profil <ExternalLink className="size-3" /></a></>}</p>}
          <ActionButton action={deleteLead.bind(null, l.id)} confirm={`${l.name} mit Verlauf löschen?`} className="btn-danger"><Trash2 className="size-4" /> Löschen</ActionButton>
        </aside>
      </div>
    </main>
  );
}
