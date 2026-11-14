"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileUp, Loader2, Plus, Send } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { createSupplier, createSupplierRequest, sendSupplierRequest, setRequestStatus, updateRequestText, updateSupplier } from "@/app/actions/lieferanten";

const KINDS: [string, string][] = [
  ["STAHL", "Stahl / Eisenhandel"],
  ["GROSSHANDEL", "Großeisenhandel"],
  ["VERZINKEREI", "Verzinkerei"],
  ["SCHLOSSERTEILE", "Schlosserteile"],
  ["SONSTIGE", "Sonstiges"],
];

type SupplierValues = { id?: string; name?: string; kind?: string; contactName?: string | null; email?: string | null; phone?: string | null; website?: string | null; street?: string | null; postalCode?: string | null; city?: string | null; customerNo?: string | null; notes?: string | null };

export function SupplierForm({ s }: { s?: SupplierValues }) {
  const action = s?.id ? updateSupplier.bind(null, s.id) : createSupplier;
  return (
    <StateForm action={action} submit={s?.id ? "Speichern" : <><Plus className="size-4" /> Anlegen</>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" required minLength={2} defaultValue={s?.name ?? ""} placeholder="Firma" className="input sm:col-span-2" aria-label="Firma" />
        <select name="kind" defaultValue={s?.kind ?? "STAHL"} className="input" aria-label="Art">
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input name="contactName" defaultValue={s?.contactName ?? ""} placeholder="Ansprechpartner (z. B. Herr Maier)" className="input" aria-label="Ansprechpartner" />
        <input name="email" type="email" defaultValue={s?.email ?? ""} placeholder="E-Mail für Anfragen" className="input" aria-label="E-Mail" />
        <input name="phone" defaultValue={s?.phone ?? ""} placeholder="Telefon" className="input" aria-label="Telefon" />
        <input name="customerNo" defaultValue={s?.customerNo ?? ""} placeholder="Unsere Kundennummer" className="input" aria-label="Kundennummer" />
        <input name="website" defaultValue={s?.website ?? ""} placeholder="Website" className="input" aria-label="Website" />
        <input name="street" defaultValue={s?.street ?? ""} placeholder="Straße" className="input" aria-label="Straße" />
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <input name="postalCode" defaultValue={s?.postalCode ?? ""} placeholder="PLZ" className="input" aria-label="PLZ" />
          <input name="city" defaultValue={s?.city ?? ""} placeholder="Ort" className="input" aria-label="Ort" />
        </div>
        <textarea name="notes" defaultValue={s?.notes ?? ""} rows={2} placeholder="Notizen (Konditionen, Lieferzeiten …)" className="input resize-y sm:col-span-2" aria-label="Notizen" />
      </div>
    </StateForm>
  );
}

export function RequestForm({ supplierId, kind, projects, hasEmail }: { supplierId: string; kind: string; projects: { id: string; name: string }[]; hasEmail: boolean }) {
  const example =
    kind === "VERZINKEREI"
      ? "12 Stk Geländerfelder 2,0 x 1,0 m, ca. 35 kg/Stk\n4 Stk Treppenwangen U 200, 3,2 m"
      : kind === "SCHLOSSERTEILE"
        ? "20 Stk Kugellager-Torrolle 80 mm\n10 Stk Torband M20 verzinkt\n2 Stk Zahnstange 1 m"
        : "12 Stk HEA 200 S235JR, 6.000 mm\n40 m Flachstahl 50x8 S235JR\n6 Tafeln Riffelblech 5/7 mm, 2000x1000";
  return (
    <StateForm action={createSupplierRequest} submit={<><Plus className="size-4" /> Anfrage vorbereiten</>}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <textarea name="positions" required rows={4} placeholder={`Eine Position je Zeile, z. B.\n${example}`} className="input w-full resize-y font-mono text-sm" aria-label="Positionen" />
      <div className="grid gap-2 sm:grid-cols-3">
        <select name="projectId" className="input" aria-label="Projekt" defaultValue="">
          <option value="">Ohne Projekt</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="delivery" className="input" aria-label="Lieferung" defaultValue="">
          <option value="">Lieferung: –</option>
          <option value="frei Werkstatt ProMont, Mannheim">frei Werkstatt</option>
          <option value="frei Baustelle">frei Baustelle</option>
          <option value="Abholung durch ProMont">Abholung</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-steel">Antwort bis<input type="date" name="dueAt" className="input w-auto flex-1" /></label>
      </div>
      <input name="note" placeholder="Zusatz (optional), z. B. „Zeugnis 3.1 erforderlich“" className="input w-full" aria-label="Zusatz" />
      {!hasEmail && <p className="text-xs text-warn">Für diesen Lieferanten ist noch keine E-Mail hinterlegt – vor dem Senden unter „Daten bearbeiten“ eintragen.</p>}
    </StateForm>
  );
}

export function RequestTextForm({ id, subject, text }: { id: string; subject: string; text: string }) {
  return (
    <StateForm action={updateRequestText.bind(null, id)} submit="Text speichern" submitClass="btn-secondary">
      <input name="subject" defaultValue={subject} className="input w-full font-medium" aria-label="Betreff" />
      <textarea name="text" defaultValue={text} rows={Math.min(28, text.split("\n").length + 2)} className="input w-full resize-y text-sm" aria-label="Mailtext" />
    </StateForm>
  );
}

export function SendRequestButton({ id, to }: { id: string; to: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | undefined>();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-primary"
        disabled={pending || !to}
        onClick={() => {
          if (!window.confirm(`Anfrage jetzt an ${to} senden?`)) return;
          start(async () => {
            setMsg(await sendSupplierRequest(id));
            router.refresh();
          });
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Jetzt senden
      </button>
      {!to && <p className="text-sm text-warn">Keine E-Mail beim Lieferanten hinterlegt.</p>}
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {msg.ok}</p>}
    </div>
  );
}

export function RequestStatusForm({ id, status, offerAmount, offerNote }: { id: string; status: string; offerAmount: number | null; offerNote: string | null }) {
  return (
    <StateForm action={setRequestStatus.bind(null, id)} submit="Speichern" submitClass="btn-secondary">
      <div className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr]">
        <select name="status" defaultValue={status === "ENTWURF" ? "GESENDET" : status} className="input" aria-label="Status">
          <option value="GESENDET">Angefragt</option>
          <option value="ANGEBOT">Angebot da</option>
          <option value="BESTELLT">Bestellt</option>
          <option value="ABGESAGT">Abgesagt</option>
        </select>
        <input name="offerAmount" inputMode="decimal" defaultValue={offerAmount !== null ? String(offerAmount).replace(".", ",") : ""} placeholder="Angebot € netto" className="input" aria-label="Angebotssumme netto" />
        <input name="offerNote" defaultValue={offerNote ?? ""} placeholder="Notiz, z. B. „Lieferung KW 48, Fracht 45 €“" className="input" aria-label="Notiz" />
      </div>
    </StateForm>
  );
}

export function CatalogUpload({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  async function send(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch(`/api/lieferanten/${supplierId}/katalog`, { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string; created?: number; updated?: number; background?: boolean };
      if (!res.ok) setMsg({ error: j.error ?? "Import fehlgeschlagen." });
      else if (j.background) setMsg({ ok: "PDF wird im Hintergrund ausgelesen – das dauert einige Minuten. Seite später neu laden." });
      else setMsg({ ok: `${j.created ?? 0} neue und ${j.updated ?? 0} aktualisierte Artikel.` });
      router.refresh();
    } catch {
      setMsg({ error: "Keine Verbindung – bitte noch einmal." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <label className={`btn-primary w-fit cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        {busy ? "Wird importiert …" : "Katalog / Preisliste hochladen"}
        <input ref={input} type="file" className="sr-only" accept=".xlsx,.csv,.txt,.tsv,.pdf,.001,.002,.003,.004,.005,.006,.007,.008,.009,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files?.[0])} />
      </label>
      <p className="text-xs text-steel">Excel (.xlsx), CSV, DATANORM 4 (Datei *.001 vom Großhändler) oder PDF-Preisliste. Gleiche Artikelnummern werden aktualisiert.</p>
      {msg?.error && <p className="text-sm text-bad" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {msg.ok}</p>}
    </div>
  );
}
