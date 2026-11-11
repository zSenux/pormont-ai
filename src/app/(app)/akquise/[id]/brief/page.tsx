import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Brief" };
export const dynamic = "force-dynamic";

/** Werbebrief im DIN-5008-Aufbau zum Drucken (Browser → Drucken/als PDF speichern) */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = z.cuid().safeParse((await params).id);
  if (!id.success) notFound();
  const l = await db.lead.findUnique({ where: { id: id.data } });
  if (!l?.letter) notFound();
  const lines = l.letter.split("\n");
  const subject = lines.find((x) => /^Betreff:/i.test(x))?.replace(/^Betreff:\s*/i, "") ?? "";
  const body = lines.filter((x) => !/^Betreff:/i.test(x)).join("\n").trim();
  const c = COMPANY;
  return (
    <main className="mx-auto max-w-[210mm] px-4 py-6 print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <article className="min-h-[297mm] bg-white px-[20mm] pt-[12mm] pb-[15mm] text-[11pt] leading-snug shadow print:shadow-none">
        <header className="flex items-start justify-between">
          <img src="/logo.svg" alt={c.name} className="h-16 w-auto" />
          <p className="text-right text-[9pt] text-steel">{c.name}<br />{c.street}<br />{c.zip} {c.city}<br />{c.phone}<br />{c.email}</p>
        </header>
        <div className="mt-[18mm] h-[45mm] w-[85mm]">
          <p className="text-[7pt] text-steel underline">{c.name} · {c.street} · {c.zip} {c.city}</p>
          <p className="mt-2">{l.name}<br />{l.contactName && <>{l.contactName}<br /></>}{l.street}<br />{[l.postalCode, l.city].filter(Boolean).join(" ")}</p>
        </div>
        <p className="text-right">{c.city}, {formatDate(new Date())}</p>
        {subject && <p className="mt-6 font-bold">{subject}</p>}
        <div className="mt-6 whitespace-pre-line">{body}</div>
        <p className="mt-8">{c.managers[0].split(" (")[0]}<br /><span className="text-steel">{c.name}</span></p>
        <footer className="mt-16 border-t border-line pt-2 text-[7.5pt] text-steel">{c.name} · {c.register} · USt-IdNr. {c.vatId} · {c.website.replace("https://", "")}</footer>
      </article>
    </main>
  );
}
