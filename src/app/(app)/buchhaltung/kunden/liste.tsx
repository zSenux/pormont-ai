"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { BadgeCheck, FilePlus2, FileSpreadsheet, MapPin, Mail, Pencil, Printer, Truck, UserPlus } from "lucide-react";
import { newDocAction } from "@/app/actions/buchhaltung";

type Row = { id: string; number: number | null; matchcode: string; lastName: string; firstName: string; street: string; place: string; open: number; href: string };

const eur = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kundentabelle: Klick markiert (Details unten), Doppelklick öffnet die Kundenakte, Pfeiltasten + Enter */
export function KundenTabelle({ rows, selId }: { rows: Row[]; selId: string | null }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const pick = (r: Row) => router.replace(r.href, { scroll: false });
  const onKey = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.id === selId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) {
        pick(n);
        ref.current?.querySelector(`[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }
    if (e.key === "Enter" && selId) router.push(`/buchhaltung/kunden/${selId}`);
  };
  const th = "sticky top-0 z-10 bg-brand-2 px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-white";
  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} className="card max-h-[50vh] overflow-auto p-0 outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Kunden, mit Pfeiltasten wählen, Enter öffnet">
      <table className="w-full min-w-[44rem] border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className={clsx(th, "text-right")}>Kd-Nr.</th>
            <th className={th}>Matchcode / Firma</th>
            <th className={th}>Name</th>
            <th className={th}>Vorname</th>
            <th className={th}>Straße</th>
            <th className={th}>PLZ, Ort</th>
            <th className={clsx(th, "text-right")}>Offen</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="p-5 text-sm text-steel">Kein Kunde gefunden.</td></tr>}
          {rows.map((r, i) => {
            const on = r.id === selId;
            const td = clsx("px-2 py-1 whitespace-nowrap", on && "text-white");
            return (
              <tr key={r.id} data-id={r.id} onClick={() => pick(r)} onDoubleClick={() => router.push(`/buchhaltung/kunden/${r.id}`)} className={clsx("cursor-default select-none border-b border-line/60", on ? "bg-brand" : i % 2 ? "bg-mist/50 hover:bg-brand-soft" : "bg-white hover:bg-brand-soft")}>
                <td className={clsx(td, "text-right")}>{r.number ?? ""}</td>
                <td className={clsx(td, "max-w-[18rem] truncate font-medium")} title={r.matchcode}>{r.matchcode}</td>
                <td className={td}>{r.lastName}</td>
                <td className={td}>{r.firstName}</td>
                <td className={clsx(td, "max-w-[14rem] truncate")}>{r.street}</td>
                <td className={td}>{r.place}</td>
                <td className={clsx(td, "text-right", !on && r.open > 0 && "font-semibold text-warn")}>{r.open ? eur(r.open) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Sel = { id: string; name: string; address: string; vatId: string | null; orderId: string | null; orderNo: string | null } | null;

/** Aktionsleiste rechts wie in Lexware (am Handy oben als zwei Spalten) */
export function KundenAktionen({ sel, exportHref }: { sel: Sel; exportHref: string }) {
  const item = "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-white/90 hover:bg-white/10";
  const off = "pointer-events-none opacity-40";
  const hr = <hr className="col-span-2 my-1 border-white/15 lg:col-span-1" />;
  return (
    <aside className="rounded-xl bg-brand-2 p-2 print:hidden lg:sticky lg:top-20 lg:self-start">
      <p className="truncate px-2.5 pb-1 text-xs font-semibold tracking-wide text-white/60 uppercase">{sel ? sel.name : "Aktionen"}</p>
      <div className="grid grid-cols-2 gap-0.5 lg:grid-cols-1">
        <Link href="/buchhaltung/kunden/neu" className={item}><UserPlus className="size-4 shrink-0" /> Kunde neu anlegen</Link>
        <Link href={sel ? `/buchhaltung/kunden/${sel.id}` : "#"} className={clsx(item, !sel && off)}><Pencil className="size-4 shrink-0" /> Kunde bearbeiten</Link>
        <a href={sel?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sel.address)}` : undefined} target="_blank" rel="noopener noreferrer" className={clsx(item, !sel?.address && off)}><MapPin className="size-4 shrink-0" /> Adresse prüfen</a>
        <a href={sel?.vatId ? "https://evatr.bff-online.de/eVatR/" : undefined} target="_blank" rel="noopener noreferrer" title={sel?.vatId ? `USt-IdNr. ${sel.vatId} beim Bundeszentralamt für Steuern prüfen` : "Keine USt-IdNr. hinterlegt"} className={clsx(item, !sel?.vatId && off)}><BadgeCheck className="size-4 shrink-0" /> USt-IdNr. prüfen</a>
        {hr}
        <form action={sel ? newDocAction.bind(null, "ANGEBOT", { customerId: sel.id }) : undefined}><button disabled={!sel} className={clsx(item, !sel && off)}><FilePlus2 className="size-4 shrink-0" /> Angebot schreiben</button></form>
        <Link href={sel?.orderId ? `/auftraege/${sel.orderId}/lieferschein` : "#"} title={sel?.orderId ? `Lieferschein zu Auftrag ${sel.orderNo}` : "Lieferscheine entstehen aus einem Auftrag (angenommenes Angebot)"} className={clsx(item, !sel?.orderId && off)}><Truck className="size-4 shrink-0" /> Lieferschein erfassen</Link>
        <form action={sel ? newDocAction.bind(null, "RECHNUNG", { customerId: sel.id }) : undefined}><button disabled={!sel} className={clsx(item, !sel && off)}><FilePlus2 className="size-4 shrink-0" /> Rechnung stellen</button></form>
        {hr}
        <button type="button" onClick={() => window.print()} className={item}><Printer className="size-4 shrink-0" /> Drucken …</button>
        <a href={exportHref} className={item}><FileSpreadsheet className="size-4 shrink-0" /> Exportieren nach Excel</a>
        <Link href={sel ? `/buchhaltung/kunden/${sel.id}/brief` : "#"} className={clsx(item, !sel && off)}><Mail className="size-4 shrink-0" /> Brief an …</Link>
      </div>
    </aside>
  );
}
