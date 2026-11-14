"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { paymentAction, sendDocAction, sendDunningAction } from "@/app/actions/buchhaltung";

type Result = { ok?: string; error?: string } | undefined | void;

/** Knopf für eine Server-Action mit Rückfrage und Fehlermeldung */
export function ResultButton({ action, confirm, children, className = "btn-secondary" }: { action: () => Promise<Result>; confirm?: string; children: ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result>();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setMsg(r);
            router.refresh();
          });
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {children}
      </button>
      {msg?.error ? <span className="text-xs text-bad" role="alert">{msg.error}</span> : null}
    </span>
  );
}

export function PaymentForm({ docId, openEuro, today }: { docId: string; openEuro: number; today: string }) {
  return (
    <StateForm action={paymentAction.bind(null, docId)} submit="Zahlung erfassen" reset className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-steel">Betrag €<input name="amount" inputMode="decimal" defaultValue={openEuro > 0 ? openEuro.toLocaleString("de-DE", { minimumFractionDigits: 2, useGrouping: false }) : ""} className="input mt-0.5" required /></label>
        <label className="text-xs text-steel">Eingang am<input name="day" type="date" defaultValue={today} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Art<select name="method" className="input mt-0.5" defaultValue="UEBERWEISUNG"><option value="UEBERWEISUNG">Überweisung</option><option value="BAR">Bar</option><option value="LASTSCHRIFT">Lastschrift</option><option value="SONSTIGES">Sonstiges</option></select></label>
      </div>
      <input name="note" maxLength={300} placeholder="Notiz (optional, z. B. Skonto, Teilzahlung)" className="input" aria-label="Notiz" />
    </StateForm>
  );
}

type MailDefaults = { an: string; betreff: string; text: string; xml?: boolean };

function MailFields({ d, xmlOption }: { d: MailDefaults; xmlOption?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">An<input name="an" type="email" multiple defaultValue={d.an} required className="input mt-0.5" /></label>
        <label className="text-xs text-steel">CC (optional)<input name="cc" type="email" multiple className="input mt-0.5" /></label>
      </div>
      <label className="block text-xs text-steel">Betreff<input name="betreff" defaultValue={d.betreff} required maxLength={300} className="input mt-0.5" /></label>
      <label className="block text-xs text-steel">Text<textarea name="text" defaultValue={d.text} rows={9} required className="input mt-0.5 resize-y" /></label>
      {xmlOption && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="xml" defaultChecked={d.xml} className="mt-1" />
          <span>Zusätzlich XRechnung (XML) anhängen – für Behörden und Kunden mit Leitweg-ID. Das PDF enthält die E-Rechnung (ZUGFeRD) immer.</span>
        </label>
      )}
    </div>
  );
}

export function SendDocForm({ docId, d, xmlOption, label }: { docId: string; d: MailDefaults; xmlOption: boolean; label: string }) {
  return (
    <StateForm action={sendDocAction.bind(null, docId)} submit={<><Send className="size-4" /> {label}</>}>
      <MailFields d={d} xmlOption={xmlOption} />
      <p className="text-xs text-steel">Die Mail geht vom Firmenpostfach raus (mit PDF im Anhang) und liegt danach im Ordner „Gesendet“.</p>
    </StateForm>
  );
}

export function SendDunningForm({ dunningId, d }: { dunningId: string; d: MailDefaults }) {
  return (
    <StateForm action={sendDunningAction.bind(null, dunningId)} submit={<><Send className="size-4" /> Mahnung senden</>}>
      <MailFields d={d} />
      <p className="text-xs text-steel">Anhänge: Mahnung und Original-Rechnung als PDF.</p>
    </StateForm>
  );
}
