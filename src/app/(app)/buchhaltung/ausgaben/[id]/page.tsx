import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { fileUrl, IMAGE_TYPES } from "@/lib/files";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { PAY_METHODS, PURCHASE_CATEGORIES } from "@/lib/buchhaltung/purchases";
import { ymdOf } from "@/lib/buchhaltung/docs";
import { deletePurchaseAction, purchasePaidAction } from "@/app/actions/ausgaben";
import { ResultButton } from "../../beleg/[id]/panels";
import { PurchaseForm } from "../form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausgabe" };

const de = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

export default async function AusgabePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  const p = await db.purchaseDoc.findUnique({ where: { id }, include: { project: { select: { id: true, name: true } } } });
  if (!p) notFound();
  const [file, projects, suppliers, bank] = await Promise.all([
    p.fileId ? db.storedFile.findUnique({ where: { id: p.fileId }, select: { id: true, mime: true } }) : null,
    db.project.findMany({ where: { OR: [{ status: { not: "FERTIG" } }, { id: p.projectId ?? "" }] }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, take: 500, select: { name: true } }),
    db.bankTx.findFirst({ where: { purchaseId: p.id }, select: { day: true, amountCents: true, name: true } }),
  ]);
  const neu = (await searchParams).neu === "1";
  return (
    <div className="space-y-4">
      <Link href="/buchhaltung/ausgaben" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Ausgaben</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">Ausgabe {p.number}</h1>
        <span className={p.status === "BEZAHLT" ? "chip border-emerald-200 bg-emerald-50 text-ok" : "chip border-amber-200 bg-amber-50 text-warn"}>{p.status === "BEZAHLT" ? `bezahlt${p.paidAt ? ` am ${formatDate(p.paidAt)}` : ""}` : "offen"}</span>
      </div>
      {neu && <p className="card flex items-center gap-2 border-emerald-200 bg-emerald-50 p-3 text-sm text-ok"><CheckCircle2 className="size-4" /> Gebucht als {p.number} – {fmtEuroCents(p.grossCents)} bei {p.supplier}.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className="card p-4">
          <PurchaseForm
            id={p.id}
            v={{ supplier: p.supplier, docNo: p.docNo ?? "", date: ymdOf(p.date)!, dueDate: ymdOf(p.dueDate) ?? "", category: p.category, gross: de(p.grossCents), tax: de(p.taxCents), taxRate: (p.taxRate === 7 ? 7 : p.taxRate === 0 ? 0 : 19) as 19 | 7 | 0, projectId: p.projectId ?? "", fileId: "", paid: p.status === "BEZAHLT", payMethod: p.payMethod ?? "", note: p.note ?? "" }}
            categories={PURCHASE_CATEGORIES}
            payMethods={PAY_METHODS}
            projects={projects}
            suppliers={suppliers.map((s) => s.name)}
          />
        </section>
        <aside className="space-y-4">
          {file && (
            <section className="card p-3">
              <a href={fileUrl(file.id)} target="_blank" rel="noreferrer">
                {IMAGE_TYPES.includes(file.mime) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(file.id)} alt="Beleg" className="w-full rounded-xl border border-line" />
                ) : (
                  <span className="block rounded-xl border border-line bg-mist p-6 text-center text-sm text-brand">Beleg-PDF öffnen</span>
                )}
              </a>
            </section>
          )}
          <section className="card space-y-2 p-4 text-sm">
            <p><span className="text-steel">Netto</span> {fmtEuroCents(p.netCents)} · <span className="text-steel">Vorsteuer</span> {fmtEuroCents(p.taxCents)}</p>
            {p.project && <p><span className="text-steel">Projekt</span> <Link href={`/projekte/${p.project.id}/nachkalkulation`} className="text-brand">{p.project.name}</Link> (zählt in der Nachkalkulation)</p>}
            {bank && <p><span className="text-steel">Bank</span> {formatDate(bank.day)} · {fmtEuroCents(bank.amountCents)} · {bank.name}</p>}
            <p className="text-xs text-steel">Erfasst {formatDateTime(p.createdAt)}{p.createdBy ? ` von ${p.createdBy}` : ""}{p.exportedAt ? ` · an Steuerberater exportiert ${formatDate(p.exportedAt)}` : ""}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {p.status === "OFFEN" ? <ResultButton action={purchasePaidAction.bind(null, p.id, true)} className="btn-primary">Als bezahlt markieren</ResultButton> : <ResultButton action={purchasePaidAction.bind(null, p.id, false)}>Wieder offen</ResultButton>}
              {!p.exportedAt && <ResultButton action={deletePurchaseAction.bind(null, p.id)} confirm={`Ausgabe ${p.number} löschen? Das Belegfoto bleibt erhalten.`} className="btn-danger"><Trash2 className="size-4" /> Löschen</ResultButton>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
