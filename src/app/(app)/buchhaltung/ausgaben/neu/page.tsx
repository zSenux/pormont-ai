import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { todayYmd } from "@/lib/berlin";
import { fileUrl, IMAGE_TYPES } from "@/lib/files";
import { PAY_METHODS, PURCHASE_CATEGORIES, purchaseFromReceipt } from "@/lib/buchhaltung/purchases";
import { PurchaseForm, type PurchaseFormValues } from "../form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausgabe erfassen" };

const de = (n: number | null) => (n === null ? "" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));

export default async function NeueAusgabe({ searchParams }: { searchParams: Promise<{ foto?: string }> }) {
  await requireUser();
  const fotoId = /^[a-z0-9]{10,40}$/.test((await searchParams).foto ?? "") ? (await searchParams).foto! : null;
  const foto = fotoId ? await db.storedFile.findUnique({ where: { id: fotoId }, select: { id: true, mime: true, kind: true } }) : null;
  const pre = foto ? await purchaseFromReceipt(foto.id).catch(() => null) : null;
  const [projects, suppliers] = await Promise.all([
    db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, take: 500, select: { name: true } }),
  ]);
  const v: PurchaseFormValues = {
    supplier: pre?.supplier ?? "",
    docNo: pre?.docNo ?? "",
    date: pre?.date ?? todayYmd(),
    dueDate: "",
    category: pre?.category ?? "MATERIAL",
    gross: de(pre?.grossEuro ?? null),
    tax: de(pre?.taxEuro ?? null),
    taxRate: pre?.taxRate ?? 19,
    projectId: pre?.projectId ?? "",
    fileId: foto?.id ?? "",
    paid: pre?.paid ?? false,
    payMethod: pre?.payMethod ?? "",
    note: "",
  };
  return (
    <div className="space-y-4">
      <Link href="/buchhaltung/ausgaben" className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Ausgaben</Link>
      <h1 className="page-title">Ausgabe erfassen</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className="card p-4">
          {pre && <p className="mb-3 rounded-xl bg-brand-soft p-3 text-sm text-brand">Jarvis hat den Beleg ausgelesen. Bitte kurz prüfen – vor allem Betrag und Datum.</p>}
          <PurchaseForm v={v} categories={PURCHASE_CATEGORIES} payMethods={PAY_METHODS} projects={projects} suppliers={suppliers.map((s) => s.name)} />
        </section>
        {foto && (
          <aside className="card p-3">
            <a href={fileUrl(foto.id)} target="_blank" rel="noreferrer">
              {IMAGE_TYPES.includes(foto.mime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(foto.id)} alt="Beleg" className="w-full rounded-xl border border-line" />
              ) : (
                <span className="block rounded-xl border border-line bg-mist p-6 text-center text-sm text-brand">PDF öffnen</span>
              )}
            </a>
          </aside>
        )}
      </div>
    </div>
  );
}
