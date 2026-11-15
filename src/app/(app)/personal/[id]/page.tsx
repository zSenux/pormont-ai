import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, CheckCircle2, ClipboardList, Circle, FileText, Lock, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/user";
import { berlinParts, formatDate } from "@/lib/berlin";
import { fileUrl } from "@/lib/files";
import { vacationBalance } from "@/lib/abwesenheit";
import { fmtDays } from "@/lib/abwesenheit-shared";
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPES, dueOf, EMP_DOC_KINDS, EMP_DOC_LABEL, EMP_TITLE_HINTS, isSensitive, noLogin, ONBOARDING, questionnaireState, type EmpDocKind } from "@/lib/personal-shared";
import { readQuestionnaire } from "@/lib/personal";
import { daysLeft, expiryState, EXPIRY_LABEL, EXPIRY_TONE } from "@/lib/nachunternehmer-shared";
import { FUNKTION_LABEL, type Funktion } from "@/lib/rights-shared";
import { checkDone, newEmployeeDoc, removeEmployeeDoc, saveProfileAction } from "@/app/actions/personal";
import { StateForm } from "@/components/state-form";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Personalakte" };
export const dynamic = "force-dynamic";

const ymd = (d: Date | null | undefined) => (d ? berlinParts(d).ymd : "");

export default async function PersonalDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ art?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const art = (await searchParams).art;
  const preKind = (EMP_DOC_KINDS as readonly string[]).includes(art ?? "") ? (art as EmpDocKind) : null;
  const u = await db.user.findUnique({ where: { id }, include: { employeeProfile: true, employeeDocs: { orderBy: [{ kind: "asc" }, { validUntil: "desc" }] } } });
  if (!u) notFound();
  const p = u.employeeProfile;
  const year = berlinParts().y;
  const vac = await vacationBalance(u.id, year);
  const hints = [...new Set(Object.values(EMP_TITLE_HINTS).flat())];
  const q = readQuestionnaire(p?.questionnaire);
  const qs = questionnaireState(q);
  const needsPermit = q.aufenthalt === "ja";
  const checklist = ONBOARDING.filter((o) => o.when !== "aufenthalt" || needsPermit).map((o) => ({ ...o, doc: u.employeeDocs.find((d) => d.kind === o.kind) }));
  const groups = EMP_DOC_KINDS.map((k) => ({ k, docs: u.employeeDocs.filter((d) => d.kind === k) })).filter((g) => g.docs.length);

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <Link href="/personal" className="text-sm text-steel hover:text-brand">← Personalakte</Link>
        <h1 className="page-title mt-1">{u.name}</h1>
        <p className="mt-1 text-sm text-steel">{[p?.jobTitle, u.funktion && FUNKTION_LABEL[u.funktion as Funktion], noLogin(u) ? "ohne App-Zugang" : u.email].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-sm text-steel">Im Betrieb seit</p><p className="text-xl font-bold">{p?.entryDate ? formatDate(p.entryDate) : "–"}</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Vertrag</p><p className="text-xl font-bold">{p?.contractType ? CONTRACT_TYPE_LABEL[p.contractType as keyof typeof CONTRACT_TYPE_LABEL] : "–"}{p?.contractUntil ? <span className="block text-sm font-normal text-warn">bis {formatDate(p.contractUntil)}</span> : null}</p></div>
        <div className="card p-4"><p className="text-sm text-steel">Resturlaub {year}</p><p className="text-xl font-bold">{fmtDays(vac.rest)}</p><Link href="/abwesenheiten" className="text-xs text-brand">Urlaub & Krank →</Link></div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-brand" /> Personalfragebogen</h2>
          <p className="mt-1 text-sm text-steel">{qs.filled === qs.total ? "Vollständig ausgefüllt" : `${qs.filled} von ${qs.total} Pflichtangaben`}{p?.questionnaireAt ? ` · zuletzt ${formatDate(p.questionnaireAt)}` : ""}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist"><div className={clsx("h-full rounded-full", qs.filled === qs.total ? "bg-ok" : "bg-brand")} style={{ width: `${Math.round((qs.filled / qs.total) * 100)}%` }} /></div>
          {qs.missing.length > 0 && <p className="mt-2 text-xs text-steel">Fehlt: {qs.missing.slice(0, 6).join(", ")}{qs.missing.length > 6 ? " …" : ""}</p>}
          <Link href={`/personal/${u.id}/fragebogen`} className="btn-primary mt-3">{qs.filled ? "Fragebogen öffnen" : "Fragebogen ausfüllen"}</Link>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Unterlagen bei Einstellung</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {checklist.map((c) => (
              <li key={c.kind} className="flex items-center gap-2">
                {c.doc ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <Circle className="size-4 shrink-0 text-line" />}
                <span className={clsx("flex-1", !c.doc && "text-steel")}>{c.label}</span>
                {c.doc?.fileId ? <a href={fileUrl(c.doc.fileId)} target="_blank" className="text-xs text-brand">ansehen</a> : !c.doc && <a href={`?art=${c.kind}#eintragen`} className="text-xs text-brand">fotografieren</a>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Dokumente & Qualifikationen</h2>
        {groups.length === 0 && <p className="mt-2 text-sm text-steel">Noch nichts eingetragen.</p>}
        {groups.map((g) => (
          <div key={g.k} className="mt-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-steel">{EMP_DOC_LABEL[g.k]}{isSensitive(g.k) && <Lock className="size-3" />}</h3>
            <ul className="mt-1 divide-y divide-line text-sm">
              {g.docs.map((d) => {
                const due = dueOf(d);
                const st = expiryState(due);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{d.title}</p>
                      <p className="text-xs text-steel">{[d.number && `Nr. ${d.number}`, d.issuedAt && `ausgestellt ${formatDate(d.issuedAt)}`, d.validUntil && `gültig bis ${formatDate(d.validUntil)}`, d.nextCheck && `nächste Kontrolle ${formatDate(d.nextCheck)}`, d.note].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={clsx("chip", EXPIRY_TONE[st])}>{due ? (st === "bald" ? `noch ${daysLeft(due)} Tage` : st === "abgelaufen" ? "abgelaufen" : "gültig") : EXPIRY_LABEL.ohne}</span>
                    {d.nextCheck && <ActionButton action={checkDone.bind(null, u.id, d.id)} className="btn-secondary px-2 py-1 text-xs" title="Kontrolle erledigt (nächste in 6 Monaten)"><CheckCircle2 className="size-3.5" /> Kontrolliert</ActionButton>}
                    {d.fileId && <a href={fileUrl(d.fileId)} target="_blank" className="btn-secondary px-2 py-1 text-xs"><FileText className="size-3.5" /> Datei</a>}
                    <ActionButton action={removeEmployeeDoc.bind(null, u.id, d.id)} confirm="Eintrag samt Datei löschen?" className="btn-secondary px-2 py-1 text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <details id="eintragen" className="mt-4 rounded-xl border border-line p-3" open={u.employeeDocs.length === 0 || !!preKind}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-brand" /> Eintragen oder abfotografieren</summary>
          <StateForm action={newEmployeeDoc.bind(null, u.id)} reset className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:w-full [&_select]:w-full [&>*]:min-w-0" submit="Speichern">
            <select key={preKind ?? "x"} name="kind" className="input" aria-label="Art" defaultValue={preKind ?? "QUALIFIKATION"}>
              {EMP_DOC_KINDS.map((k) => <option key={k} value={k}>{EMP_DOC_LABEL[k]}{isSensitive(k) ? " (vertraulich)" : ""}</option>)}
            </select>
            <input key={`t-${preKind ?? "x"}`} name="title" required list="emp-hints" defaultValue={preKind ? (EMP_TITLE_HINTS[preKind]?.[0] ?? "") : ""} placeholder="Bezeichnung, z. B. Staplerschein" className="input" aria-label="Bezeichnung" />
            <datalist id="emp-hints">{hints.map((h) => <option key={h} value={h} />)}</datalist>
            <input name="number" placeholder="Nummer (optional)" className="input" aria-label="Nummer" />
            <label className="text-xs text-steel">Ausgestellt <input type="date" name="issuedAt" className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Gültig bis <input type="date" name="validUntil" className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Nächste Kontrolle (z. B. Führerschein) <input type="date" name="nextCheck" className="input mt-1 w-full" /></label>
            <label className="block cursor-pointer rounded-xl border border-dashed border-brand/50 bg-brand-soft/30 p-3 text-sm sm:col-span-2">
              <span className="flex items-center gap-2"><Camera className="size-5 shrink-0 text-brand" /><strong>Abfotografieren</strong></span>
              <span className="mt-1 block text-xs text-steel">Seite für Seite, z. B. den Arbeitsvertrag. Mehrere Fotos werden automatisch zu einem PDF.</span>
              <input type="file" name="scan" accept="image/*" capture="environment" multiple className="mt-2 text-xs" aria-label="Fotografieren" />
            </label>
            <label className="text-xs text-steel sm:col-span-2">oder Datei hochladen (PDF/Bild, auch mehrere)
              <input type="file" name="file" accept="application/pdf,image/*" multiple className="input mt-1 w-full" aria-label="Datei" />
            </label>
            <input name="note" placeholder="Notiz (optional)" className="input sm:col-span-2" aria-label="Notiz" />
            <p className="text-xs text-steel sm:col-span-2">Verträge, Ausweise, Steuer-/SV-Unterlagen, Vorsorge und Sonstiges sieht nur der Admin. Führerschein, Qualifikationen und Unterweisungen sieht der Mitarbeiter selbst (ohne Datei).</p>
          </StateForm>
        </details>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Lock className="size-4 text-brand" /> Stammdaten (vertraulich)</h2>
        <StateForm action={saveProfileAction.bind(null, u.id)} className="mt-3 grid gap-2 sm:grid-cols-3" submit="Speichern">
          <input name="jobTitle" defaultValue={p?.jobTitle ?? ""} placeholder="Tätigkeit, z. B. Metallbauer" className="input" aria-label="Tätigkeit" />
          <label className="text-xs text-steel">Geburtsdatum <input type="date" name="birthDate" defaultValue={ymd(p?.birthDate)} className="input mt-1 w-full" /></label>
          <input name="privatePhone" defaultValue={p?.privatePhone ?? ""} placeholder="Telefon privat" className="input" aria-label="Telefon privat" />
          <input name="street" defaultValue={p?.street ?? ""} placeholder="Straße" className="input" aria-label="Straße" />
          <div className="grid grid-cols-[5rem_1fr] gap-2"><input name="zip" defaultValue={p?.zip ?? ""} placeholder="PLZ" className="input" aria-label="PLZ" /><input name="city" defaultValue={p?.city ?? ""} placeholder="Ort" className="input" aria-label="Ort" /></div>
          <input name="privateEmail" defaultValue={p?.privateEmail ?? ""} placeholder="E-Mail privat" className="input" aria-label="E-Mail privat" />
          <input name="emergencyContact" defaultValue={p?.emergencyContact ?? ""} placeholder="Notfallkontakt (Name, Telefon)" className="input sm:col-span-3" aria-label="Notfallkontakt" />
          <label className="text-xs text-steel">Eintritt <input type="date" name="entryDate" defaultValue={ymd(p?.entryDate)} className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Vertragsart
            <select name="contractType" defaultValue={p?.contractType ?? ""} className="input mt-1 w-full">
              <option value="">–</option>
              {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{CONTRACT_TYPE_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="text-xs text-steel">Befristet bis <input type="date" name="contractUntil" defaultValue={ymd(p?.contractUntil)} className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Wochenstunden <input name="weeklyHours" inputMode="decimal" defaultValue={p?.weeklyHours ?? ""} className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Lohn / Gehalt <input name="wage" defaultValue={p?.wage ?? ""} placeholder="z. B. 19,50 €/Std." className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Austritt <input type="date" name="exitDate" defaultValue={ymd(p?.exitDate)} className="input mt-1 w-full" /></label>
          <textarea name="notes" defaultValue={p?.notes ?? ""} rows={3} placeholder="Notizen (vertraulich)" className="input sm:col-span-3" aria-label="Notizen" />
          {p && <p className="text-xs text-steel sm:col-span-3">Zuletzt geändert {formatDate(p.updatedAt)}{p.updatedBy ? ` von ${p.updatedBy}` : ""}.</p>}
        </StateForm>
      </section>
    </main>
  );
}
