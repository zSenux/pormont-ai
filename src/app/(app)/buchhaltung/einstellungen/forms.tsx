"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StateForm } from "@/components/state-form";
import { removeLetterheadAction, saveBookConfigAction, saveLetterheadAction, setNextNumberAction, startImportAction } from "@/app/actions/buchhaltung";
import type { BookConfig } from "@/lib/buchhaltung/config";

const n = (v: number) => String(v).replace(".", ",");

export function ConfigForm({ c }: { c: BookConfig }) {
  return (
    <StateForm action={saveBookConfigAction} submit="Speichern">
      <h3 className="text-sm font-semibold">Bankverbindung und Steuer (steht im Fuß jedes Belegs)</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel sm:col-span-2">IBAN<input name="iban" defaultValue={c.iban} placeholder="leer = Standard von ProMont" className="input mt-0.5 font-mono" /></label>
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="autoDunning" defaultChecked={c.autoDunning} className="size-4 accent-brand" /> Mahnvorschläge automatisch erstellen (Push an die Geschäftsführung – gesendet wird erst nach Freigabe)</label>
        <label className="text-xs text-steel">Erinnerung Tage nach Fälligkeit<input name="reminderAfterDays" inputMode="numeric" defaultValue={c.reminderAfterDays} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Nächste Stufe Tage nach Mahnfrist<input name="nextLevelAfterDays" inputMode="numeric" defaultValue={c.nextLevelAfterDays} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Nicht mahnen unter €<input name="dunningMinEuro" inputMode="decimal" defaultValue={n(c.dunningMinEuro)} className="input mt-0.5" /></label>
      </div>
      <h3 id="datev" className="scroll-mt-24 pt-2 text-sm font-semibold">DATEV (Angaben vom Steuerberater)</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-steel">Beraternummer<input name="datevBerater" inputMode="numeric" defaultValue={c.datevBerater} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Mandantennummer<input name="datevMandant" inputMode="numeric" defaultValue={c.datevMandant} className="input mt-0.5" /></label>
        <label className="text-xs text-steel">Kontenrahmen<select name="datevSkr" defaultValue={c.datevSkr} className="input mt-0.5"><option value="03">SKR 03</option><option value="04">SKR 04</option></select></label>
        <label className="text-xs text-steel">Wirtschaftsjahr beginnt im Monat<input name="datevWjMonth" inputMode="numeric" defaultValue={c.datevWjMonth} className="input mt-0.5" /></label>
      </div>
      <h3 className="pt-2 text-sm font-semibold">Standardtexte</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">Angebot – Einleitung<textarea name="quoteIntro" defaultValue={c.quoteIntro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Angebot – Schluss<textarea name="quoteOutro" defaultValue={c.quoteOutro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Rechnung – Einleitung<textarea name="invoiceIntro" defaultValue={c.invoiceIntro} rows={2} className="input mt-0.5 resize-y" /></label>
        <label className="text-xs text-steel">Rechnung – Schluss<textarea name="invoiceOutro" defaultValue={c.invoiceOutro} rows={2} className="input mt-0.5 resize-y" /></label>
      </div>
      <h3 id="textbausteine" className="pt-2 text-sm font-semibold">Textbausteine (VOB/B, AGB, § 13b, „gemäß beiliegendem Angebot“ …)</h3>
      <p className="text-xs text-steel">Im Beleg mit einem Klick unten einfügen. „Immer unten“ setzt den Baustein automatisch in jeden neuen Beleg dieser Art. <code>{"{angebot}"}</code> wird durch Nummer und Datum des Angebots ersetzt. Zum Löschen den Namen leeren.</p>
      <div className="space-y-2">
        {[...c.textBlocks, ...Array.from({ length: 3 }, () => null)].map((b, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[12rem_1fr_8rem]">
            <input name={`tb_title_${i}`} defaultValue={b?.title ?? ""} placeholder="Name, z. B. VOB/B" maxLength={60} className="input" aria-label="Name des Bausteins" />
            <textarea name={`tb_text_${i}`} defaultValue={b?.text ?? ""} placeholder="Text, der auf den Beleg kommt" rows={2} maxLength={2000} className="input resize-y" aria-label="Text des Bausteins" />
            <div className="space-y-1">
              <select name={`tb_for_${i}`} defaultValue={b?.for ?? "ALLE"} className="input" aria-label="Für"><option value="ALLE">Angebot + Rechnung</option><option value="ANGEBOT">nur Angebot</option><option value="RECHNUNG">nur Rechnung</option></select>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`tb_std_${i}`} defaultChecked={b?.standard ?? false} className="size-4 accent-brand" /> Immer unten</label>
            </div>
          </div>
        ))}
      </div>
      <h3 className="pt-2 text-sm font-semibold">Auftragsbestätigung</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmOnAccept" defaultChecked={c.confirmOnAccept} className="size-4 accent-brand" /> Wenn ein Angebot angenommen wird: Auftragsbestätigung an den Kunden zum Senden bereitlegen (gesendet wird erst nach deinem Klick)</label>
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

/** Eigenes Briefpapier: Datei + Freiräume oben/unten */
export function LetterheadForm({ c }: { c: BookConfig }) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <StateForm action={saveLetterheadAction} submit={c.letterheadFileId ? "Speichern" : "Briefpapier hochladen"} onOk={() => router.refresh()} className="space-y-3">
        <label className="block text-sm">
          {c.letterheadFileId ? <>Aktuell: <strong>{c.letterheadName}</strong> – neue Datei wählen, um es zu ersetzen</> : "Briefpapier als PDF (A4, Seite 2 = Folgeseiten) oder Bild (PNG/JPG, A4)"}
          <input type="file" name="datei" accept="application/pdf,image/png,image/jpeg" className="input mt-1" />
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="letterheadOnly" defaultChecked={c.letterheadOnly} className="mt-1" /> Das Briefpapier hat schon Briefkopf und Fußzeile (Logo und Fußzeile von Jarvis weglassen)</label>
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="text-xs text-steel">Freiraum oben auf Folgeseiten (mm)<input name="letterheadTopMm" inputMode="numeric" defaultValue={c.letterheadTopMm} className="input mt-0.5" /></label>
          <label className="text-xs text-steel">Freiraum unten für die Fußzeile (mm)<input name="letterheadBottomMm" inputMode="numeric" defaultValue={c.letterheadBottomMm} className="input mt-0.5" /></label>
        </div>
      </StateForm>
      {c.letterheadFileId && (
        <div className="flex flex-wrap gap-2">
          <a href="/api/buchhaltung/briefpapier" target="_blank" className="btn-secondary">Probe-PDF ansehen</a>
          <form action={removeLetterheadAction}><button className="btn-secondary text-bad">Briefpapier entfernen</button></form>
        </div>
      )}
    </div>
  );
}
