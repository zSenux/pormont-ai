import Link from "next/link";
import { ExternalLink, FileDown } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatEuro } from "@/lib/berlin";
import { lexwareConfigured, LexwareError } from "@/lib/lexware/client";
import { STATUS_DE, VOUCHER_TYPES, voucherLink, voucherList, type VoucherKind } from "@/lib/lexware/api";

export const metadata = { title: "Belege" };
export const dynamic = "force-dynamic";

const ARTEN: { key: VoucherKind; label: string }[] = [
  { key: "rechnungen", label: "Rechnungen" },
  { key: "angebote", label: "Angebote" },
  { key: "auftragsbestaetigungen", label: "Auftragsbestätigungen" },
  { key: "gutschriften", label: "Gutschriften" },
];

const STATUS: Record<VoucherKind, { key: string; label: string; lex?: string }[]> = {
  rechnungen: [
    { key: "alle", label: "Alle" },
    { key: "ueberfaellig", label: "Überfällig", lex: "overdue" },
    { key: "offen", label: "Offen", lex: "open" },
    { key: "bezahlt", label: "Bezahlt", lex: "paid,paidoff" },
    { key: "entwurf", label: "Entwürfe", lex: "draft" },
  ],
  angebote: [
    { key: "alle", label: "Alle" },
    { key: "offen", label: "Offen", lex: "open" },
    { key: "angenommen", label: "Angenommen", lex: "accepted" },
    { key: "abgelehnt", label: "Abgelehnt", lex: "rejected" },
    { key: "entwurf", label: "Entwürfe", lex: "draft" },
  ],
  auftragsbestaetigungen: [{ key: "alle", label: "Alle" }],
  gutschriften: [{ key: "alle", label: "Alle" }],
  lieferscheine: [{ key: "alle", label: "Alle" }],
  eingangsrechnungen: [{ key: "alle", label: "Alle" }],
};

const TONE: Record<string, string> = {
  overdue: "border-red-200 bg-red-50 text-bad",
  open: "border-amber-200 bg-amber-50 text-warn",
  paid: "border-green-200 bg-green-50 text-ok",
  paidoff: "border-green-200 bg-green-50 text-ok",
  accepted: "border-green-200 bg-green-50 text-ok",
  rejected: "border-line bg-mist text-steel",
  draft: "border-line bg-mist text-steel",
  voided: "border-line bg-mist text-steel",
};

export default async function BelegePage({ searchParams }: { searchParams: Promise<{ art?: string; status?: string; seite?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const art = (ARTEN.find((a) => a.key === sp.art)?.key ?? "rechnungen") as VoucherKind;
  const statusList = STATUS[art];
  const status = statusList.find((s) => s.key === sp.status) ?? statusList[0];
  const page = Math.max(0, Number(sp.seite ?? 0) || 0);
  const href = (o: { art?: string; status?: string; seite?: number }) => `/belege?art=${o.art ?? art}&status=${o.status ?? status.key}${o.seite ? `&seite=${o.seite}` : ""}`;

  let content: React.ReactNode;
  if (!lexwareConfigured()) content = <p className="card p-5 text-sm text-steel">Lexware ist noch nicht verbunden (LEXWARE_API_KEY fehlt).</p>;
  else {
    try {
      const r = await voucherList({ type: VOUCHER_TYPES[art], status: status.lex, page, size: 25 });
      content = r.content.length ? (
        <>
          <ul className="card divide-y divide-line">
            {r.content.map((v) => {
              const link = voucherLink(v.voucherType, v.id);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{v.contactName ?? "–"}</p>
                    <p className="text-xs text-steel">
                      {v.voucherNumber ?? "Entwurf"} · {formatDate(v.voucherDate)}
                      {v.dueDate ? ` · fällig ${formatDate(v.dueDate)}` : ""}
                    </p>
                  </div>
                  <span className={clsx("chip", TONE[v.voucherStatus] ?? "border-line bg-mist text-steel")}>{STATUS_DE[v.voucherStatus] ?? v.voucherStatus}</span>
                  <div className="w-28 text-right">
                    <p className="font-semibold">{formatEuro(v.totalAmount)}</p>
                    {v.openAmount !== undefined && v.openAmount > 0 && v.openAmount !== v.totalAmount && <p className="text-xs text-warn">offen {formatEuro(v.openAmount)}</p>}
                  </div>
                  <div className="flex gap-1">
                    {v.voucherStatus !== "draft" && link && (
                      <a href={`/api/lexware/pdf/${v.voucherType}/${v.id}`} target="_blank" rel="noreferrer" className="btn-secondary !px-3 !py-1.5" aria-label="PDF öffnen">
                        <FileDown className="size-4" />
                      </a>
                    )}
                    {link && (
                      <a href={link} target="_blank" rel="noreferrer" className="btn-secondary !px-3 !py-1.5" aria-label="In Lexware öffnen">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between text-sm text-steel">
            <span>
              {r.totalElements} Belege · Seite {page + 1} von {Math.max(1, r.totalPages)}
            </span>
            <div className="flex gap-2">
              {page > 0 && <Link className="btn-secondary" href={href({ seite: page - 1 })}>Zurück</Link>}
              {!r.last && <Link className="btn-secondary" href={href({ seite: page + 1 })}>Weiter</Link>}
            </div>
          </div>
        </>
      ) : (
        <p className="card p-5 text-sm text-steel">Keine Belege in dieser Auswahl.</p>
      );
    } catch (e) {
      content = <p className="card border-red-200 bg-red-50 p-5 text-sm text-bad">{e instanceof LexwareError ? e.message : "Lexware ist gerade nicht erreichbar."}</p>;
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-6 md:py-10">
      <div>
        <h1 className="page-title">Belege</h1>
        <p className="mt-1 text-sm text-steel">Live aus Lexware Office. Neue Rechnungen und Angebote erstellst du am schnellsten mit Jarvis.</p>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {ARTEN.map((a) => (
          <Link key={a.key} href={`/belege?art=${a.key}`} className={clsx("btn shrink-0", a.key === art ? "bg-brand text-white" : "border border-line bg-white text-steel")}>
            {a.label}
          </Link>
        ))}
      </div>
      {statusList.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {statusList.map((s) => (
            <Link key={s.key} href={href({ status: s.key })} className={clsx("chip shrink-0 px-3 py-1", s.key === status.key ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-steel")}>
              {s.label}
            </Link>
          ))}
        </div>
      )}
      {content}
    </main>
  );
}
