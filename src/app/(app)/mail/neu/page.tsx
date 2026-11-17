import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireArea } from "@/lib/rights";
import { formatDateTime } from "@/lib/berlin";
import { readMail, MailError } from "@/lib/mail/client";
import { mailAddress, mailConfig } from "@/lib/mail/config";
import { validMailId } from "@/lib/mail/types";
import { Compose } from "./compose";

export const metadata = { title: "Neue Mail" };
export const dynamic = "force-dynamic";

const EMAIL = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g;
const emails = (s: string) => [...new Set((s.match(EMAIL) ?? []).map((x) => x.toLowerCase()))];
const prefixed = (subject: string, p: "AW" | "WG") => (new RegExp(`^(${p}|${p === "AW" ? "RE" : "FW|FWD"}):`, "i").test(subject.trim()) ? subject.trim() : `${p}: ${subject.trim()}`);
const quote = (text: string) => text.split(/\r?\n/).map((l) => `> ${l}`).join("\n");

export default async function NewMail({ searchParams }: { searchParams: Promise<{ antwort?: string; alle?: string; weiter?: string; an?: string }> }) {
  await requireArea("mail");
  const sp = await searchParams;
  const cfg = mailConfig();
  if (!cfg) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="card p-4 text-sm">Das Postfach ist noch nicht verbunden (Einstellungen → Verbindungen).</div>
      </main>
    );
  }
  const own = mailAddress(cfg).toLowerCase();
  const sourceId = validMailId(sp.antwort) ? sp.antwort : validMailId(sp.weiter) ? sp.weiter : null;
  const mode = validMailId(sp.antwort) ? "antwort" : validMailId(sp.weiter) ? "weiter" : "neu";

  let init = { an: typeof sp.an === "string" ? sp.an.slice(0, 300) : "", cc: "", betreff: "", text: "" };
  let original: { from: string; date: string | null; attachments: number } | null = null;
  if (sourceId) {
    try {
      const m = await readMail(sourceId);
      const head = `Am ${m.date ? formatDateTime(m.date) : "?"} schrieb ${m.from}${m.fromAddress ? ` <${m.fromAddress}>` : ""}:`;
      original = { from: m.from, date: m.date, attachments: m.attachments.length };
      if (mode === "antwort") {
        const cc = sp.alle === "1" ? [...emails(m.to), ...emails(m.cc)].filter((a) => a !== own && a !== m.fromAddress.toLowerCase()) : [];
        init = { an: m.fromAddress, cc: [...new Set(cc)].join(", "), betreff: prefixed(m.subject, "AW"), text: `\n\n\n${head}\n${quote(m.text)}` };
      } else {
        const fwd = ["---------- Weitergeleitete Nachricht ----------", `Von: ${m.from}${m.fromAddress ? ` <${m.fromAddress}>` : ""}`, m.date ? `Datum: ${formatDateTime(m.date)}` : "", `Betreff: ${m.subject}`, `An: ${m.to}`, m.cc ? `CC: ${m.cc}` : ""].filter(Boolean).join("\n");
        init = { an: "", cc: "", betreff: prefixed(m.subject, "WG"), text: `\n\n\n${fwd}\n\n${m.text}` };
      }
    } catch (e) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-6">
          <div className="card border-red-200 bg-red-50 p-4 text-sm text-bad">{e instanceof MailError ? e.message : "Mail konnte nicht geladen werden."}</div>
        </main>
      );
    }
  }

  const title = mode === "antwort" ? (sp.alle === "1" ? "Allen antworten" : "Antworten") : mode === "weiter" ? "Weiterleiten" : "Neue Mail";
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10">
      <Link href={sourceId ? `/mail/${sourceId}` : "/mail"} className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft className="size-4" /> {sourceId ? "Zurück zur Mail" : "Posteingang"}
      </Link>
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="mt-1 text-sm text-steel">Von {mailAddress(cfg)}</p>
      </div>
      <Compose
        init={init}
        reply={mode === "antwort" ? sourceId : null}
        forward={mode === "weiter" ? sourceId : null}
        originalAttachments={mode === "weiter" ? (original?.attachments ?? 0) : 0}
      />
    </main>
  );
}
