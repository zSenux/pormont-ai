import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Reply, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { formatDateTime } from "@/lib/berlin";
import { readMail, MailError } from "@/lib/mail/client";
import { mailConfigured } from "@/lib/mail/config";
import { UnreadButton } from "./unread-button";

export const metadata = { title: "Mail" };
export const dynamic = "force-dynamic";

const ask = (q: string) => `/jarvis?q=${encodeURIComponent(q)}`;

export default async function MailDetail({ params }: { params: Promise<{ uid: string }> }) {
  await requireUser();
  const uid = Number((await params).uid);
  if (!Number.isInteger(uid) || uid <= 0 || !mailConfigured()) notFound();
  let m;
  try {
    m = await readMail(uid, true);
  } catch (e) {
    if (e instanceof MailError && /nicht gefunden/.test(e.message)) notFound();
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-bad">{e instanceof Error ? e.message : "Fehler."}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10">
      <Link href="/mail" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft className="size-4" /> Posteingang
      </Link>
      <article className="card space-y-4 p-5">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold leading-snug">{m.subject}</h1>
          <p className="text-sm">
            <span className="font-medium">{m.from}</span> {m.fromAddress && <span className="text-steel">&lt;{m.fromAddress}&gt;</span>}
          </p>
          <p className="text-xs text-steel">
            An: {m.to}
            {m.cc && ` · CC: ${m.cc}`}
            {m.date && ` · ${formatDateTime(m.date)}`}
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          <Link href={ask(`Fasse die Mail uid ${m.uid} kurz zusammen und sag mir, was zu tun ist.`)} className="btn-secondary">
            <Sparkles className="size-4" /> Zusammenfassen
          </Link>
          <Link href={ask(`Schreib mir eine Antwort auf die Mail uid ${m.uid}. Zeig sie mir erst, bevor du sie zum Senden vorschlägst.`)} className="btn-primary">
            <Reply className="size-4" /> Antwort mit Jarvis
          </Link>
          <UnreadButton uid={m.uid} />
        </div>
        {m.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {m.attachments.map((a, i) => (
              <li key={i}>
                <a href={`/api/mail/${m.uid}/anhang/${i}`} className="chip gap-1 bg-mist px-3 py-1 text-ink">
                  <Download className="size-3.5" /> {a.filename} <span className="text-steel">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="whitespace-pre-wrap break-words border-t border-line pt-4 text-[15px] leading-relaxed">{m.text || "(kein Text)"}</div>
      </article>
    </main>
  );
}
