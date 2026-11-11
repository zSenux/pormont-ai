import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { KIND_LABEL, MEAL_LABEL, STATUS_LABEL, euro, type ExpenseKind, type MealDay } from "@/lib/spesen";
import { monthLabel, monthRange, thisMonth } from "@/lib/zeiten";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Spesenzettel" };
export const dynamic = "force-dynamic";

/** Spesenzettel (Reisekostenabrechnung) eines Mitarbeiters für einen Monat – zum Drucken/Unterschreiben */
export default async function ZettelPage({ searchParams }: { searchParams: Promise<{ monat?: string; user?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : thisMonth();
  const uid = me.role === "ADMIN" && sp.user ? z.cuid().safeParse(sp.user).data : me.id;
  if (!uid) notFound();
  const user = await db.user.findUnique({ where: { id: uid }, select: { name: true } });
  if (!user) notFound();
  const r = monthRange(month);
  const rows = await db.expense.findMany({ where: { userId: uid, day: { gte: r.from, lt: r.to }, status: { not: "ABGELEHNT" } }, orderBy: [{ day: "asc" }, { createdAt: "asc" }], include: { project: { select: { name: true } } } });
  const byKind = (k: ExpenseKind) => rows.filter((e) => e.kind === k).reduce((s, e) => s + e.amountCents, 0);
  const total = rows.reduce((s, e) => s + e.amountCents, 0);
  const c = COMPANY;
  const detail = (e: (typeof rows)[number]) =>
    e.kind === "VERPFLEGUNG"
      ? [MEAL_LABEL[e.mealDay as MealDay], [e.breakfast && "Frühstück", e.lunch && "Mittag", e.dinner && "Abendessen"].filter(Boolean).join(", ") && `gestellt: ${[e.breakfast && "Frühstück", e.lunch && "Mittag", e.dinner && "Abendessen"].filter(Boolean).join(", ")}`].filter(Boolean).join(" · ")
      : e.kind === "FAHRT"
        ? `${e.km} km × 0,30 €`
        : e.fileId
          ? "Beleg liegt vor"
          : "ohne Beleg";

  return (
    <main className="mx-auto max-w-[210mm] px-4 py-6 print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <article className="bg-white p-[12mm] text-[10pt] shadow print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-bold">Spesenabrechnung</h1>
            <p>{user.name} · {monthLabel(month)}</p>
          </div>
          <img src="/logo.svg" alt={c.name} className="h-12 w-auto" />
        </header>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-ink text-left text-[9pt]"><th className="py-1.5 pr-2">Datum</th><th className="py-1.5 pr-2">Art</th><th className="py-1.5 pr-2">Anlass / Projekt</th><th className="py-1.5 pr-2">Angaben</th><th className="py-1.5 text-right">Betrag</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-steel">Keine Spesen in diesem Monat.</td></tr>}
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-line align-top">
                <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(e.day)}</td>
                <td className="py-1.5 pr-2">{KIND_LABEL[e.kind as ExpenseKind]}</td>
                <td className="py-1.5 pr-2 [overflow-wrap:anywhere]">{e.description}{e.project ? ` · ${e.project.name}` : ""}</td>
                <td className="py-1.5 pr-2 text-[9pt] text-steel">{detail(e)}{e.status !== "EINGEREICHT" ? ` · ${STATUS_LABEL[e.status]}` : " · offen"}</td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{euro(e.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mt-4 ml-auto text-right">
          <tbody>
            {(["VERPFLEGUNG", "FAHRT", "UEBERNACHTUNG", "AUSLAGE"] as const).filter((k) => byKind(k)).map((k) => (
              <tr key={k}><td className="pr-4 text-steel">{KIND_LABEL[k]}</td><td className="tabular-nums">{euro(byKind(k))}</td></tr>
            ))}
            <tr className="border-t border-ink font-bold"><td className="pr-4 pt-1">Summe</td><td className="pt-1 tabular-nums">{euro(total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-6 text-[8.5pt] text-steel">Verpflegungspauschalen und Kilometersatz nach § 9 EStG (Richtwerte). Belege zu Übernachtung und Auslagen liegen digital in Jarvis. Stand {formatDateTime(new Date())}.</p>
        <div className="mt-14 grid grid-cols-2 gap-10 text-[9pt]">
          <p className="border-t border-ink pt-1">Datum, Unterschrift Mitarbeiter</p>
          <p className="border-t border-ink pt-1">Datum, Unterschrift {c.name}</p>
        </div>
      </article>
    </main>
  );
}
