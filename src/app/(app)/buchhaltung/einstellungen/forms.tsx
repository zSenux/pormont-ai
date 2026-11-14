"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StateForm } from "@/components/state-form";
import { saveBookConfigAction, setNextNumberAction, startImportAction } from "@/app/actions/buchhaltung";
import type { BookConfig } from "@/lib/buchhaltung/config";

const n = (v: number) => String(v).replace(".", ",");

export function ConfigForm({ c }: { c: BookConfig }) {
  return (
    <StateForm action={saveBookConfigAction} submit="Speichern">
      <h3 className="text-sm font-semibold">Bankverbindung und Steuer (steht im Fuß jedes Belegs)</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel sm:col-span-2">IBAN<input name="iban" defaultValue={c.iban} placeholder="DE00 0000 0000 0000 0000 00" className="input mt-0.5 font-mono" /></label>
        <label className="text-xs text-steel">BIC<input name="bic" defaultValue={c.bic} className="input mt-0.5 font-mono" /></label>
        <label className="text-xs text-steel">Bank<input name="bankName" defaultValue={c.bankName} placeholder="z. B. Sparkasse Rhein Neckar Nord" className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Steuernummer (Finanzamt)<input name="taxNumber" defaultValue={c.taxNumber} placeholder="z. B. 38/123/45678" className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Ansprechpartner in der E-Rechnung<input name="contactName" defaultValue={c.contactName} className="input mt-0.5" /></label>
      </div>
      <h3 className="pt-2 text-sm font-semibold">Fristen und Mahnwesen</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-xs text-steel">Zahlungsziel (Tage)<input name="paymentDays" inputMode="numeric" defaultValue={c.paymentDays} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Angebot gültig (Tage)<input name="quoteDays" inputMode="numeric" defaultValue={c.quoteDays} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Mahnfrist (Tage)<input name="dunningDays" inputMode="numeric" defaultValue={c.dunningDays} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Gebühr 1. Mahnung €<input name="dunningFee1" inputMode="decimal" defaultValue={n(c.dunningFee1)} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Gebühr 2. Mahnung €<input name="dunningFee2" inputMode="decimal" defaultValue={n(c.dunningFee2)} className="input mt-0.5" /></label>
      </div>
      <h3 className="pt-2 text-sm font-semibold">Standardtexte</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">Angebot – Einleitung<textarea name="quoteIntro" defaultValue={c.quoteIntro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Angebot – Schluss<textarea name="quoteOutro" defaultValue={c.quoteOutro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Rechnung – Einleitung<textarea name="invoiceIntro" defaultValue={c.invoiceIntro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Rechnung – Schluss<textarea name="invoiceOutro" defaultValue={c.invoiceOutro} rows={2} className="input mt-0.5 resize-y" /></label>
      </div>
    </StateForm>
  );
}

export function NumberForm({ year }: { year: number }) {
  return (
    <StateForm action={setNextNumberAction} submit="Übernehmen" className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <select name="kind" className="input" aria-label="Art"><option value="RECHNUNG">Rechnungen</option><option value="ANGEBOT">Angebote</option><option value="GUTSCHRIFT">Gutschriften</option></select>
        <input name="year" inputMode="numeric" defaultValue={year} className="input" aria-label="Jahr" />
        <input name="next" inputMode="numeric" placeholder="nächste Nr." className="input" aria-label="Nächste Nummer" required />
      </div>
    </StateForm>
  );
}

export function ImportForm({ running }: { running: boolean }) {
  const router = useRouter();
  // Während die Übernahme läuft, alle 4 s neu laden
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [running, router]);
  return (
    <StateForm action={startImportAction} submit={running ? "Läuft …" : "Aus Lexware übernehmen"} onOk={() => router.refresh()}>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="angebote" defaultChecked className="mt-1" /> Offene Angebote mit übernehmen</label>
      <label className="block text-sm">Bezahlte Rechnungen und Gutschriften ab (für die Umsatz-Statistik, optional)
        <input type="date" name="seit" className="input mt-1 max-w-xs" />
      </label>
    </StateForm>
  );
}
