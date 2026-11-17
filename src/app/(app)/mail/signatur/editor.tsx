"use client";

import { useMemo, useState, useTransition } from "react";
import { Save, Send } from "lucide-react";
import { clsx } from "clsx";
import { saveSignatureAction, signatureTestAction } from "@/app/actions/mail";
import { hasGreeting, SIGNATURE_LAYOUTS, signatureHtml, textToHtml, type SignatureCompany, type SignatureConfig, type SignaturePerson } from "@/lib/mail/signature-shared";

type CompanyPart = Omit<SignatureConfig, "users">;

const SAMPLE = "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Anbei erhalten Sie unser Angebot.\nBei Fragen melden Sie sich gerne.";

const TOGGLES: { key: keyof CompanyPart; label: string }[] = [
  { key: "showLogo", label: "Logo" },
  { key: "showSubtitle", label: "Leistungen (Untertitel)" },
  { key: "showAddress", label: "Adresse" },
  { key: "showPhone", label: "Telefon Firma" },
  { key: "showMobile", label: "Mobil Firma" },
  { key: "showEmail", label: "E-Mail" },
  { key: "showWebsite", label: "Website" },
  { key: "showLegal", label: "Pflichtangaben GmbH" },
];

export function SignatureEditor(p: { isAdmin: boolean; name: string; email: string; mailbox: string; company: SignatureCompany; initialCompany: CompanyPart; initialPerson: SignaturePerson }) {
  const [c, setC] = useState<CompanyPart>(p.initialCompany);
  const [me, setMe] = useState<SignaturePerson>(p.initialPerson);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [phone, setPhone] = useState(false);

  const set = <K extends keyof CompanyPart>(k: K, v: CompanyPart[K]) => setC((x) => ({ ...x, [k]: v }));
  const setP = <K extends keyof SignaturePerson>(k: K, v: SignaturePerson[K]) => setMe((x) => ({ ...x, [k]: v }));

  const doc = useMemo(() => {
    const cfg = { ...c, users: {} } as SignatureConfig;
    const sig = c.enabled ? signatureHtml(cfg, p.company, { name: p.name, ...me }, { logoSrc: "/logo.png", mailbox: p.mailbox, withGreeting: !hasGreeting(SAMPLE) }) : "";
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#fff}</style></head><body>${textToHtml(SAMPLE)}${sig}</body></html>`;
  }, [c, me, p.company, p.name, p.mailbox]);

  const save = () =>
    start(async () => {
      setMsg((await saveSignatureAction({ company: p.isAdmin ? c : undefined, person: me })) ?? null);
    });
  const test = () =>
    startTest(async () => {
      const r = await saveSignatureAction({ company: p.isAdmin ? c : undefined, person: me });
      setMsg(r?.error ? r : ((await signatureTestAction()) ?? null));
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Deine Angaben</h2>
          <p className="text-sm text-steel">Name: {p.name}</p>
          <Field label="Position">
            <input className="input w-full" value={me.position} maxLength={80} onChange={(e) => setP("position", e.target.value)} placeholder="z. B. Projektleitung" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Durchwahl">
              <input className="input w-full" value={me.phone} maxLength={40} onChange={(e) => setP("phone", e.target.value)} placeholder={p.company.phone} />
            </Field>
            <Field label="Mobil">
              <input className="input w-full" value={me.mobile} maxLength={40} onChange={(e) => setP("mobile", e.target.value)} placeholder="optional" />
            </Field>
          </div>
          <Field label="Eigene E-Mail (leer = Postfach)">
            <input className="input w-full" type="email" value={me.email} maxLength={120} onChange={(e) => setP("email", e.target.value)} placeholder={p.mailbox} />
          </Field>
        </section>

        {p.isAdmin && (
          <section className="card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Firmenteil (für alle)</h2>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Signatur an
              </label>
            </div>
            <Field label="Grußformel">
              <input className="input w-full" value={c.greeting} maxLength={80} onChange={(e) => set("greeting", e.target.value)} placeholder="leer = ohne" />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Aufbau">
                <div className="flex gap-1">
                  {SIGNATURE_LAYOUTS.map((l) => (
                    <button key={l} type="button" onClick={() => set("layout", l)} className={clsx("chip px-3 py-1", c.layout === l ? "border-brand bg-brand text-white" : "bg-white text-steel")}>
                      {l === "seitlich" ? "Logo links" : "Logo unten"}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Farbe">
                <input type="color" className="h-9 w-14 cursor-pointer rounded border border-line" value={c.color} onChange={(e) => set("color", e.target.value)} />
              </Field>
              <Field label={`Logo-Breite ${c.logoWidth} px`}>
                <input type="range" min={100} max={260} step={10} value={c.logoWidth} onChange={(e) => set("logoWidth", Number(e.target.value))} disabled={!c.showLogo} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {TOGGLES.map((t) => (
                <label key={t.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(c[t.key])} onChange={(e) => set(t.key, e.target.checked as never)} /> {t.label}
                </label>
              ))}
            </div>
            {!c.showLegal && <p className="text-xs text-bad">Geschäftliche Mails einer GmbH müssen Sitz, Registergericht, HRB-Nummer und alle Geschäftsführer nennen (§ 35a GmbHG).</p>}
            <Field label="Hinweis unten (z. B. Vertraulichkeit, Umwelt)">
              <textarea className="input w-full resize-y text-sm" rows={2} maxLength={600} value={c.note} onChange={(e) => set("note", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.forSystem} onChange={(e) => set("forSystem", e.target.checked)} /> Auch unter Rechnungen, Angeboten, Mahnungen und Preisanfragen
            </label>
            <p className="text-xs text-steel">Firmendaten kommen aus den Stammdaten ({p.company.name}, {p.company.street}, {p.company.zip} {p.company.city}).</p>
          </section>
        )}

        {msg?.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-bad">{msg.error}</p>}
        {msg?.ok && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg.ok}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={save} disabled={pending}>
            <Save className="size-4" /> {pending ? "Speichert …" : "Speichern"}
          </button>
          <button className="btn-secondary" onClick={test} disabled={testing || !p.email} title={p.email ? `an ${p.email}` : "Kein E-Mail-Konto hinterlegt"}>
            <Send className="size-4" /> {testing ? "Sendet …" : "Probe an mich senden"}
          </button>
        </div>
      </div>

      <section className="space-y-2 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Vorschau</h2>
          <div className="flex gap-1">
            <button type="button" onClick={() => setPhone(false)} className={clsx("chip px-3 py-1", !phone ? "border-brand bg-brand text-white" : "bg-white text-steel")}>PC</button>
            <button type="button" onClick={() => setPhone(true)} className={clsx("chip px-3 py-1", phone ? "border-brand bg-brand text-white" : "bg-white text-steel")}>Handy</button>
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="border-b border-line bg-mist px-4 py-2 text-xs text-steel">
            <div>Von: {p.mailbox}</div>
            <div>Betreff: Ihr Angebot</div>
          </div>
          <iframe title="Vorschau der Signatur" sandbox="" srcDoc={doc} className={clsx("keep-light block h-[560px] bg-white", phone ? "mx-auto w-[375px] border-x border-line" : "w-full")} />
        </div>
        {!c.enabled && <p className="text-sm text-steel">Die Signatur ist ausgeschaltet.</p>}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}
