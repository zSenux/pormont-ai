import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/user";
import { berlinParts, formatDate } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { readQuestionnaire } from "@/lib/personal";
import { QUESTIONNAIRE, questionnaireState } from "@/lib/personal-shared";
import { saveQuestionnaireAction } from "@/app/actions/personal";
import { StateForm } from "@/components/state-form";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Personalfragebogen" };
export const dynamic = "force-dynamic";

/** Personalfragebogen: am PC/Handy ausfüllen, ausdrucken, unterschreiben lassen und unterschrieben in die Akte fotografieren */
export default async function Fragebogen({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const u = await db.user.findUnique({ where: { id }, select: { id: true, name: true, employeeProfile: true } });
  if (!u) notFound();
  const p = u.employeeProfile;
  const q = readQuestionnaire(p?.questionnaire);
  // Vorbelegen aus den Stammdaten, wenn im Fragebogen noch nichts steht
  const [vor, ...rest] = u.name.split(" ").reverse();
  const pre: Record<string, string> = {
    nachname: vor ?? "",
    vorname: rest.reverse().join(" "),
    geburtsdatum: p?.birthDate ? berlinParts(p.birthDate).ymd : "",
    anschrift: [p?.street, [p?.zip, p?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    telefon: p?.privatePhone ?? "",
    email: p?.privateEmail ?? "",
    notfall: p?.emergencyContact ?? "",
  };
  const val = (k: string) => q[k] ?? pre[k] ?? "";
  const st = questionnaireState(q);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="mr-auto">
          <Link href={`/personal/${u.id}`} className="text-sm text-steel hover:text-brand">← Akte {u.name}</Link>
          <h1 className="page-title mt-1">Personalfragebogen</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-steel"><Lock className="size-4 text-brand" /> Vertraulich – nur Administratoren. {st.filled} von {st.total} Pflichtangaben.</p>
        </div>
        <PrintButton label="Drucken zum Unterschreiben" />
      </div>
      <div className="hidden print:block">
        <p className="text-xs">{COMPANY.name} · {COMPANY.street} · {COMPANY.zip} {COMPANY.city}</p>
        <h1 className="mt-2 text-xl font-bold">Personalfragebogen – {u.name}</h1>
      </div>

      <StateForm action={saveQuestionnaireAction.bind(null, u.id)} submit="Fragebogen speichern" submitClass="btn-primary print:hidden" className="space-y-4">
        {QUESTIONNAIRE.map((sec) => (
          <fieldset key={sec.title} className="card p-5 print:break-inside-avoid print:rounded-none print:border print:p-3 print:shadow-none">
            <legend className="px-1 font-semibold text-brand">{sec.title}</legend>
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
              {sec.fields.map((f) => (
                <label key={f.key} className={f.wide ? "text-xs text-steel sm:col-span-2" : "text-xs text-steel"}>
                  {f.label}{f.need && <span className="text-bad"> *</span>}
                  {f.type === "select" ? (
                    <select name={`q_${f.key}`} defaultValue={val(f.key)} className="input mt-0.5 w-full">
                      <option value="">–</option>
                      {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input name={`q_${f.key}`} type={f.type === "date" ? "date" : "text"} defaultValue={val(f.key)} maxLength={200} autoComplete="off" className="input mt-0.5 w-full" />
                  )}
                  {f.hint && <span className="mt-0.5 block text-[11px] print:hidden">{f.hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-steel print:hidden">Geburtsdatum, Anschrift, Telefon und Notfallkontakt werden aus den Stammdaten vorgeschlagen; Telefon, E-Mail und Notfallkontakt landen beim Speichern auch dort. Ausgedruckt und unterschrieben bitte in der Akte als „Personalfragebogen“ abfotografieren.</p>
        <div className="hidden pt-10 print:grid print:grid-cols-2 print:gap-10">
          <div className="border-t border-ink pt-1 text-xs">Ort, Datum</div>
          <div className="border-t border-ink pt-1 text-xs">Unterschrift Mitarbeiter/in</div>
          <p className="col-span-2 text-[10px]">Ich versichere, dass die Angaben richtig und vollständig sind. Änderungen (z. B. Anschrift, Steuerklasse, Krankenkasse) teile ich unverzüglich mit. Die Daten werden nur für das Beschäftigungsverhältnis verarbeitet (Art. 6 Abs. 1 lit. b, c DSGVO, § 26 BDSG). Stand {formatDate(new Date())}.</p>
        </div>
      </StateForm>
    </main>
  );
}
