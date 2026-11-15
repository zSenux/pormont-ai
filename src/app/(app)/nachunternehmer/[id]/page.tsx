import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, FileCheck2, FileText, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { berlinParts, formatDate } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { ampelOf, AMPEL_LABEL, AMPEL_TONE, BAGATELL_EUR, BAUABZUG_PCT, daysLeft, exemptionValid, expiryState, EXPIRY_LABEL, EXPIRY_TONE, NU_CONTRACT_LABEL, NU_CONTRACT_STATUSES, NU_DOC_KINDS, NU_DOC_LABEL, NU_REQUIRED, type NuContractStatus, type NuDocKind } from "@/lib/nachunternehmer-shared";
import { changeContractStatus, newContract, newNuDoc, removeNuDoc, saveSubcontractor } from "@/app/actions/nachunternehmer";
import { StateForm } from "@/components/state-form";
import { ActionButton } from "@/components/confirm-button";

export const dynamic = "force-dynamic";
const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export default async function NuDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await db.subcontractor.findUnique({
    where: { id },
    include: { docs: { orderBy: [{ kind: "asc" }, { validUntil: "desc" }] }, contracts: { orderBy: { createdAt: "desc" }, include: { project: { select: { id: true, name: true } } } } },
  });
  if (!s) notFound();
  const projects = await db.project.findMany({ where: { status: { not: "FERTIG" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const check = ampelOf(s.docs);
  const exempt = exemptionValid(s.docs);
  const year = berlinParts().y;
  const yearNet = s.contracts.filter((c) => c.status !== "STORNIERT" && c.startDate && berlinParts(c.startDate).y === year).reduce((t, c) => t + (c.amountNet ?? 0), 0);
  const deduct = !exempt && yearNet * 1.19 >= BAGATELL_EUR;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <Link href="/nachunternehmer" className="text-sm text-steel hover:text-brand">← Nachunternehmer</Link>
        <h1 className="page-title mt-1 flex items-center gap-3"><span className={clsx("size-3.5 rounded-full", AMPEL_TONE[check.ampel])} />{s.name}</h1>
        <p className="mt-1 text-sm text-steel">{[s.trade, s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "Keine Kontaktdaten"}</p>
      </div>

      <section className={clsx("card flex items-start gap-3 p-4 text-sm", exempt ? "border-ok/40" : "border-bad/40 bg-red-50")}>
        {exempt ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" />}
        <div>
          <p className="font-semibold">{exempt ? "Freistellung § 48b gültig – Zahlung ohne Steuerabzug." : "Keine gültige Freistellung § 48b!"}</p>
          {!exempt && (
            <p className="mt-1">
              Ohne gültige Freistellungsbescheinigung muss ProMont bei Bauleistungen {BAUABZUG_PCT} % der Rechnung (brutto) einbehalten und ans Finanzamt abführen – außer die Zahlungen an diesen Nachunternehmer bleiben im Jahr unter {eur(BAGATELL_EUR)}.
              {" "}Verträge {year}: {eur(yearNet * 1.19)} brutto{deduct ? " → Steuerabzug nötig." : "."} Bitte aktuelle Bescheinigung anfordern und beim BZSt prüfen. Keine Steuerberatung – im Zweifel Steuerberater fragen.
            </p>
          )}
          <p className="mt-1 text-steel">{AMPEL_LABEL[check.ampel]}{check.missing.length ? ` · fehlt: ${check.missing.map((k) => NU_DOC_LABEL[k]).join(", ")}` : ""}</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><FileCheck2 className="size-4 text-brand" /> Nachweise</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {NU_REQUIRED.filter((k) => !s.docs.some((d) => d.kind === k)).map((k) => (
              <li key={k} className="flex items-center justify-between gap-2 py-2 text-bad"><span>{NU_DOC_LABEL[k]}</span><span className="chip border-bad/30 bg-red-50 text-bad">fehlt</span></li>
            ))}
            {s.docs.map((d) => {
              const st = expiryState(d.validUntil);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{NU_DOC_LABEL[d.kind as NuDocKind] ?? d.kind}{d.title ? ` – ${d.title}` : ""}</p>
                    <p className="text-xs text-steel">{[d.number && `Nr. ${d.number}`, d.validFrom && `ab ${formatDate(d.validFrom)}`, d.validUntil && `bis ${formatDate(d.validUntil)}`, d.note].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className={clsx("chip", EXPIRY_TONE[st])}>{st === "bald" && d.validUntil ? `noch ${daysLeft(d.validUntil)} Tage` : EXPIRY_LABEL[st]}</span>
                  {d.fileId && <a href={fileUrl(d.fileId)} target="_blank" className="btn-secondary px-2 py-1 text-xs"><FileText className="size-3.5" /> Datei</a>}
                  <ActionButton action={removeNuDoc.bind(null, s.id, d.id)} confirm="Nachweis löschen?" className="btn-secondary px-2 py-1 text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
                </li>
              );
            })}
          </ul>
          <details className="mt-3 rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-brand" /> Nachweis hochladen</summary>
            <StateForm action={newNuDoc.bind(null, s.id)} reset className="mt-3 grid gap-2 sm:grid-cols-2" submit="Speichern">
              <select name="kind" className="input sm:col-span-2" aria-label="Art" defaultValue="FREISTELLUNG_48B">
                {NU_DOC_KINDS.map((k) => <option key={k} value={k}>{NU_DOC_LABEL[k]}</option>)}
              </select>
              <input name="number" placeholder="Nr. / Sicherheitsnummer" className="input" aria-label="Nummer" />
              <input name="title" placeholder="Bezeichnung (optional)" className="input" aria-label="Bezeichnung" />
              <label className="text-xs text-steel">Gültig ab <input type="date" name="validFrom" className="input mt-1 w-full" /></label>
              <label className="text-xs text-steel">Gültig bis <input type="date" name="validUntil" className="input mt-1 w-full" /></label>
              <input type="file" name="file" accept="application/pdf,image/*" className="input sm:col-span-2" aria-label="Datei" />
              <input name="note" placeholder="Notiz (optional)" className="input sm:col-span-2" aria-label="Notiz" />
            </StateForm>
          </details>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Stammdaten</h2>
          <StateForm action={saveSubcontractor.bind(null, s.id)} className="mt-3 grid gap-2" submit="Speichern">
            <input name="name" required defaultValue={s.name} className="input" aria-label="Firma" />
            <input name="trade" defaultValue={s.trade ?? ""} placeholder="Gewerk" className="input" aria-label="Gewerk" />
            <input name="contactName" defaultValue={s.contactName ?? ""} placeholder="Ansprechpartner" className="input" aria-label="Ansprechpartner" />
            <input name="phone" defaultValue={s.phone ?? ""} placeholder="Telefon" className="input" aria-label="Telefon" />
            <input name="email" type="email" defaultValue={s.email ?? ""} placeholder="E-Mail" className="input" aria-label="E-Mail" />
            <input name="street" defaultValue={s.street ?? ""} placeholder="Straße" className="input" aria-label="Straße" />
            <div className="grid grid-cols-[6rem_1fr] gap-2"><input name="zip" defaultValue={s.zip ?? ""} placeholder="PLZ" className="input" aria-label="PLZ" /><input name="city" defaultValue={s.city ?? ""} placeholder="Ort" className="input" aria-label="Ort" /></div>
            <input name="taxNumber" defaultValue={s.taxNumber ?? ""} placeholder="Steuernummer" className="input" aria-label="Steuernummer" />
            <textarea name="notes" defaultValue={s.notes ?? ""} placeholder="Notizen" rows={2} className="input" aria-label="Notizen" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} className="size-4 accent-brand" /> aktiv</label>
          </StateForm>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Verträge</h2>
        {s.contracts.length === 0 ? (
          <p className="mt-2 text-sm text-steel">Noch keine Verträge.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {s.contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.number} · {c.title}</p>
                  <p className="text-xs text-steel">
                    {[c.project && <Link key="p" href={`/projekte/${c.project.id}`} className="underline">{c.project.name}</Link>, c.amountNet != null && `${eur(c.amountNet)} netto`, c.retentionPct && `${c.retentionPct} % Sicherheitseinbehalt`, (c.startDate || c.endDate) && `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`]
                      .filter(Boolean)
                      .map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
                  </p>
                </div>
                <form action={changeContractStatus.bind(null, s.id, c.id)} className="flex gap-1">
                  <select name="status" defaultValue={c.status} className="input py-1 text-xs" aria-label={`Status ${c.number}`}>
                    {NU_CONTRACT_STATUSES.map((k) => <option key={k} value={k}>{NU_CONTRACT_LABEL[k as NuContractStatus]}</option>)}
                  </select>
                  <button className="btn-secondary px-2 py-1 text-xs">OK</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 rounded-xl border border-line p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-brand" /> Vertrag anlegen</summary>
          <StateForm action={newContract.bind(null, s.id)} reset className="mt-3 grid gap-2 sm:grid-cols-2" submit="Anlegen">
            <input name="title" required placeholder="Leistung, z. B. „Kranarbeiten Vordach“" className="input sm:col-span-2" aria-label="Titel" />
            <select name="projectId" className="input sm:col-span-2" aria-label="Projekt" defaultValue="">
              <option value="">ohne Projekt</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input name="amountNet" inputMode="decimal" placeholder="Auftragssumme netto €" className="input" aria-label="Betrag" />
            <input name="retentionPct" inputMode="decimal" placeholder="Sicherheitseinbehalt %" className="input" aria-label="Sicherheitseinbehalt" />
            <label className="text-xs text-steel">Beginn <input type="date" name="startDate" className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Ende <input type="date" name="endDate" className="input mt-1 w-full" /></label>
            <select name="status" defaultValue="BEAUFTRAGT" className="input" aria-label="Status">
              {NU_CONTRACT_STATUSES.map((k) => <option key={k} value={k}>{NU_CONTRACT_LABEL[k]}</option>)}
            </select>
            <textarea name="scope" rows={2} placeholder="Leistungsumfang" className="input sm:col-span-2" aria-label="Leistungsumfang" />
          </StateForm>
        </details>
      </section>
    </main>
  );
}
