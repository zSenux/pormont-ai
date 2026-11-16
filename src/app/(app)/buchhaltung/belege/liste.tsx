"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { ArrowRightLeft, Copy, FileCode2, FilePlus2, FileSpreadsheet, Mail, Pencil, Printer } from "lucide-react";
import { copyAction, newDocAction } from "@/app/actions/buchhaltung";
import type { ListRow } from "@/lib/buchhaltung/belegliste";

const eur = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

/** Status-Farbe kompakt (wie die Kennzeichen in der Lexware-Liste, aber ausgeschrieben) */
const TONE: Record<string, string> = {
  ENTWURF: "text-steel",
  OFFEN: "text-warn",
  UEBERFAELLIG: "text-bad font-semibold",
  BEZAHLT: "text-ok",
  ANGENOMMEN: "text-ok",
  ABGELEHNT: "text-steel",
  STORNIERT: "text-steel line-through",
};

export function BelegTabelle({ rows, exportHref }: { rows: ListRow[]; exportHref: string }) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(rows[0]?.id ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const tableRef = useRef<HTMLDivElement>(null);
  const sel = rows.find((r) => r.id === selId) ?? null;

  useEffect(() => {
    if (!rows.some((r) => r.id === selId)) setSelId(rows[0]?.id ?? null);
  }, [rows, selId]);

  const open = (r: ListRow) => router.push(`/buchhaltung/beleg/${r.id}`);
  const copy = (kind: "ANGEBOT" | "RECHNUNG") => {
    if (!sel) return;
    setMsg(null);
    start(async () => {
      const r = await copyAction(sel.id, kind);
      if (r?.error) setMsg(r.error);
    });
  };

  // Pfeiltasten wie in der Lexware-Liste: hoch/runter markiert, Enter öffnet
  const onKey = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((r) => r.id === selId));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      setSelId(n.id);
      tableRef.current?.querySelector(`[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && sel) open(sel);
  };

  const canCopy = sel && (sel.kind === "ANGEBOT" || sel.kind === "RECHNUNG");
  const canContinue = sel?.kind === "ANGEBOT" && sel.status !== "ABGELEHNT";
  const canMail = sel && !sel.imported && sel.status !== "ENTWURF" && sel.status !== "STORNIERT" && sel.hasPdf;

  const item = "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-white/90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  const actions = (
    <>
      <form action={newDocAction.bind(null, "ANGEBOT", {})}><button className={item}><FilePlus2 className="size-4 shrink-0" /> Angebot schreiben</button></form>
      <form action={newDocAction.bind(null, "RECHNUNG", {})}><button className={item}><FilePlus2 className="size-4 shrink-0" /> Rechnung stellen</button></form>
      <hr className="col-span-2 my-1 border-white/15 lg:col-span-1" />
      <button className={item} disabled={!sel} onClick={() => sel && open(sel)}><Pencil className="size-4 shrink-0" /> {sel?.status === "ENTWURF" ? "Beleg bearbeiten" : "Beleg öffnen"}</button>
      <button className={item} disabled={!canContinue || busy} onClick={() => copy("RECHNUNG")} title="Angebot → Rechnung (Entwurf)"><ArrowRightLeft className="size-4 shrink-0" /> Weiterführen zur Rechnung</button>
      <button className={item} disabled={!canCopy || busy} onClick={() => sel && copy(sel.kind as "ANGEBOT" | "RECHNUNG")}><Copy className="size-4 shrink-0" /> Beleg duplizieren</button>
      <hr className="col-span-2 my-1 border-white/15 lg:col-span-1" />
      <a className={clsx(item, !sel?.hasPdf && "pointer-events-none opacity-40")} href={sel?.hasPdf ? `/api/buchhaltung/pdf/${sel.id}` : undefined} target="_blank" rel="noopener" aria-disabled={!sel?.hasPdf}><Printer className="size-4 shrink-0" /> Drucken …</a>
      <a className={item} href={exportHref}><FileSpreadsheet className="size-4 shrink-0" /> Exportieren nach Excel</a>
      <a className={clsx(item, !canMail && "pointer-events-none opacity-40")} href={canMail ? `/buchhaltung/beleg/${sel!.id}#senden` : undefined} aria-disabled={!canMail}><Mail className="size-4 shrink-0" /> Per E-Mail senden</a>
      <a className={clsx(item, !sel?.hasXml && "pointer-events-none opacity-40")} href={sel?.hasXml ? `/api/buchhaltung/xml/${sel.id}` : undefined} aria-disabled={!sel?.hasXml}><FileCode2 className="size-4 shrink-0" /> E-Rechnung (XRechnung)</a>
      {sel?.imported && <p className="col-span-2 lg:col-span-1 px-2.5 pt-2 text-xs text-white/60">Aus Lexware übernommen: nur ansehen{sel.hasPdf ? " und drucken" : ""}, keine E-Rechnung.</p>}
      {msg && <p className="col-span-2 lg:col-span-1 px-2.5 pt-2 text-xs text-red-200">{msg}</p>}
    </>
  );

  const th = "sticky top-0 z-10 bg-brand-2 px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-white";
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13.5rem]">
      <div ref={tableRef} tabIndex={0} onKeyDown={onKey} className="card max-h-[70vh] overflow-auto p-0 outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Belege, mit Pfeiltasten wählen, Enter öffnet">
        <table className="w-full min-w-[50rem] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th className={th}>Datum</th>
              <th className={th}>Art</th>
              <th className={th}>Belegnr.</th>
              <th className={th}>Notiz</th>
              <th className={th}>Status</th>
              <th className={clsx(th, "text-right")}>Kd-Nr.</th>
              <th className={th}>Matchcode / Kunde</th>
              <th className={clsx(th, "text-right")}>Gesamt</th>
              <th className={clsx(th, "text-right")}>Abschlag</th>
              <th className={clsx(th, "text-right")}>Forderung</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="p-5 text-sm text-steel">Keine Belege in diesem Zeitraum. Anderes Jahr wählen oder zu Jarvis sagen: „Mach ein Angebot für …“</td></tr>
            )}
            {rows.map((r, i) => {
              const on = r.id === selId;
              const td = clsx("px-2 py-1 whitespace-nowrap", on ? "text-white" : "");
              return (
                <tr key={r.id} data-id={r.id} onClick={() => setSelId(r.id)} onDoubleClick={() => open(r)} className={clsx("cursor-default select-none border-b border-line/60", on ? "bg-brand" : i % 2 ? "bg-mist/50 hover:bg-brand-soft" : "bg-white hover:bg-brand-soft")}>
                  <td className={td}>{day(r.date)}</td>
                  <td className={clsx(td, "font-semibold")} title={r.artLabel}>{r.art}</td>
                  <td className={clsx(td, "font-medium")}>
                    <span className="inline-flex items-center gap-1">
                      {r.number ?? <em className={on ? "text-white/80" : "text-steel"}>Entwurf</em>}
                      {r.imported && <span className={clsx("rounded px-1 text-[10px] font-medium", on ? "bg-white/20 text-white" : "bg-mist text-steel")} title="Aus Lexware übernommen">LX</span>}
                    </span>
                  </td>
                  <td className={clsx(td, "max-w-[11rem] truncate")} title={r.note}>{r.note}</td>
                  <td className={clsx(td, on ? "" : TONE[r.tone])} title={r.sent ? "per Mail gesendet" : undefined}>{r.statusText}{r.sent && r.status !== "BEZAHLT" ? " ✉" : ""}</td>
                  <td className={clsx(td, "text-right")}>{r.customerNo ?? ""}</td>
                  <td className={clsx(td, "max-w-[12rem] truncate")} title={r.customer}>{r.customer}</td>
                  <td className={clsx(td, "text-right")}>{eur(r.gross)}</td>
                  <td className={clsx(td, "text-right")}>{eur(r.prepaid)}</td>
                  <td className={clsx(td, "text-right font-semibold")}>{eur(r.claim)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <aside className="rounded-xl bg-brand-2 p-2 lg:sticky lg:top-20 lg:self-start">
        <p className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-white/60 uppercase">{sel ? `${sel.artLabel} ${sel.number ?? "(Entwurf)"}` : "Aktionen"}</p>
        <div className="grid grid-cols-2 gap-0.5 lg:grid-cols-1">{actions}</div>
      </aside>
    </div>
  );
}

