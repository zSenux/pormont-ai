import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { LEXWARE_APP } from "@/lib/lexware/client";
import { fileUrl, IMAGE_TYPES } from "@/lib/files";
import { receiptData } from "@/lib/receipts";
import { formatDateTime, formatEuro } from "@/lib/berlin";
import { deleteFile } from "@/app/actions/work";
import { ActionButton } from "@/components/confirm-button";
import { Uploader } from "@/components/upload";

export const metadata = { title: "Beleg fotografieren" };
export const dynamic = "force-dynamic";

export default async function BelegFotoPage() {
  await requireUser();
  const receipts = await db.storedFile.findMany({ where: { kind: "beleg" }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, name: true, mime: true, createdAt: true, summary: true, meta: true, lexFileId: true, uploadedBy: true } });
  const booked = new Map((await db.purchaseDoc.findMany({ where: { fileId: { in: receipts.map((r) => r.id) } }, select: { id: true, fileId: true, number: true } })).map((p) => [p.fileId, p]));
  const open = receipts.filter((r) => !r.lexFileId && !booked.has(r.id));

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/buchhaltung/ausgaben" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft className="size-4" /> Ausgaben
      </Link>
      <div>
        <h1 className="page-title">Beleg fotografieren</h1>
        <p className="mt-1 text-sm text-steel">Kassenbon oder Rechnung fotografieren – Jarvis liest Lieferant, Datum und Betrag. Mit einem Tipp wird er als Ausgabe gebucht – vorher kurz prüfen.</p>
      </div>
      <div className="card space-y-2 p-5">
        <Uploader kind="beleg" label="Beleg fotografieren" camera multiple={false} />
        <p className="text-xs text-steel">Tipp: Beleg flach hinlegen, ganz im Bild, gutes Licht. PDFs aus Mails gehen auch.</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">{open.length ? `${open.length} noch nicht gebucht` : "Alle Belege sind gebucht"}</h2>
        <ul className="space-y-3">
          {receipts.length === 0 && <li className="card p-5 text-sm text-steel">Noch keine Belege fotografiert.</li>}
          {receipts.map((r) => {
            const d = receiptData.safeParse(r.meta);
            const data = d.success ? d.data : null;
            return (
              <li key={r.id} className="card flex gap-4 p-4">
                <a href={fileUrl(r.id)} target="_blank" rel="noreferrer" className="shrink-0">
                  {IMAGE_TYPES.includes(r.mime) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(r.id)} alt="Beleg" loading="lazy" className="size-20 rounded-xl border border-line object-cover" />
                  ) : (
                    <span className="grid size-20 place-items-center rounded-xl border border-line bg-mist text-xs font-semibold text-steel">PDF</span>
                  )}
                </a>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{data?.lieferant ?? (data && !data.lesbar ? "Nicht lesbar" : r.summary ?? "Beleg")}</p>
                  {data && data.lesbar && (
                    <p className="text-sm">
                      {data.brutto !== null && <span className="font-semibold">{formatEuro(data.brutto)}</span>}
                      {data.ust !== null && <span className="text-steel"> · USt. {formatEuro(data.ust)}{data.ustSatz ? ` (${data.ustSatz} %)` : ""}</span>}
                      {data.datum && <span className="text-steel"> · {data.datum.split("-").reverse().join(".")}</span>}
                    </p>
                  )}
                  <p className="text-xs text-steel">{[data?.kategorie, data?.zahlart, data?.belegnummer && `Nr. ${data.belegnummer}`].filter(Boolean).join(" · ")}</p>
                  {data?.hinweis && <p className="text-xs text-warn">{data.hinweis}</p>}
                  {!data && <p className="text-xs text-warn">Jarvis konnte den Beleg nicht auslesen – du kannst ihn trotzdem von Hand buchen.</p>}
                  <p className="text-xs text-steel">{formatDateTime(r.createdAt)}{r.uploadedBy && ` · ${r.uploadedBy}`}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {booked.get(r.id) ? (
                      <Link href={`/buchhaltung/ausgaben/${booked.get(r.id)!.id}`} className="chip border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-ok"><CheckCircle2 className="size-3.5" /> Gebucht als {booked.get(r.id)!.number}</Link>
                    ) : r.lexFileId && r.lexFileId !== "wird-hochgeladen" ? (
                      <>
                        <span className="chip border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-ok"><CheckCircle2 className="size-3.5" /> Früher an Lexware übergeben</span>
                        <a href={`${LEXWARE_APP}/vouchers`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand">Lexware <ExternalLink className="size-3" /></a>
                      </>
                    ) : (
                      <Link href={`/buchhaltung/ausgaben/neu?foto=${r.id}`} className="btn-primary px-3 py-1.5 text-xs">Als Ausgabe buchen</Link>
                    )}
                    {!booked.get(r.id) && (
                      <ActionButton action={deleteFile.bind(null, r.id)} confirm="Belegfoto löschen?" className="ml-auto text-steel/60 hover:text-bad" title="Löschen">
                        <Trash2 className="size-4" />
                      </ActionButton>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
