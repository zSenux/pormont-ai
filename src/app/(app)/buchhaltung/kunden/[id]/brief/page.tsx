import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, todayYmd } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { greetingFor } from "@/lib/buchhaltung/docs";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Brief" };
export const dynamic = "force-dynamic";

/** „Brief an …“ aus der Kundenliste: Geschäftsbrief mit Anschrift, Text direkt auf der Seite schreiben, drucken bzw. als PDF speichern */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();
  const address = [c.name, c.kind === "FIRMA" && c.contactName ? `z. Hd. ${c.contactName}` : null, c.street, [c.zip, c.city].filter(Boolean).join(" "), c.country !== "DE" ? c.country : null].filter(Boolean) as string[];
  const greeting = greetingFor(c) ?? "Sehr geehrte Damen und Herren,";
  const edit = "rounded outline-none hover:bg-brand-soft/40 focus:bg-brand-soft/40 print:hover:bg-transparent";
  return (
    <main className="mx-auto max-w-3xl space-y-4 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/buchhaltung/kunden?k=${c.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" /> Kunden</Link>
        <PrintButton />
      </div>
      <p className="text-sm text-steel print:hidden">Betreff und Text direkt im Brief anklicken und schreiben. Gespeichert wird nichts – drucken oder als PDF sichern.</p>
      <article className="keep-light card space-y-8 p-8 text-[14px] leading-relaxed print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt={COMPANY.name} className="h-12 w-auto" />
          <p className="text-right text-xs text-steel">{COMPANY.name}<br />{COMPANY.street}<br />{COMPANY.zip} {COMPANY.city}<br />Tel. {COMPANY.phone}<br />{COMPANY.email}</p>
        </header>
        <section>
          <p className="text-[10px] text-steel underline">{COMPANY.name} · {COMPANY.street} · {COMPANY.zip} {COMPANY.city}</p>
          <div className="mt-2">{address.map((l, i) => <p key={i}>{l}</p>)}</div>
        </section>
        <p className="text-right">{COMPANY.city}, {formatDate(new Date(`${todayYmd()}T12:00:00`))}</p>
        <div contentEditable suppressContentEditableWarning className={`${edit} font-semibold`}>Betreff</div>
        <div contentEditable suppressContentEditableWarning className={`${edit} min-h-40 whitespace-pre-wrap`}>{`${greeting}\n\n\n\nMit freundlichen Grüßen\n\n${COMPANY.name}`}</div>
        <footer className="border-t border-line pt-2 text-[10px] text-steel">
          {COMPANY.name} · {COMPANY.register} · USt-IdNr. {COMPANY.vatId} · {COMPANY.bank.name} · IBAN {COMPANY.bank.iban} · {COMPANY.web}
        </footer>
      </article>
    </main>
  );
}
