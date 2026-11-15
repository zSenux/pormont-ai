import Link from "next/link";
import { AlertTriangle, IdCard, ShieldCheck, UserPlus } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { expiringEmployeeDocs } from "@/lib/personal";
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPES, dueOf, EMP_DOC_LABEL, EMP_SENSITIVE, noLogin, questionnaireState, type EmpDocKind } from "@/lib/personal-shared";
import { readQuestionnaire } from "@/lib/personal";
import { StateForm } from "@/components/state-form";
import { newEmployeeAction } from "@/app/actions/personal";
import { daysLeft, expiryState, EXPIRY_LABEL, EXPIRY_TONE } from "@/lib/nachunternehmer-shared";
import { FUNKTION_LABEL, FUNKTIONEN, type Funktion } from "@/lib/rights-shared";

export const metadata = { title: "Personalakte" };
export const dynamic = "force-dynamic";

function DueChip({ d }: { d: { validUntil: Date | null; nextCheck: Date | null } }) {
  const due = dueOf(d);
  const st = expiryState(due);
  return <span className={clsx("chip text-[11px]", EXPIRY_TONE[st])}>{due ? (st === "abgelaufen" ? `abgelaufen ${formatDate(due)}` : st === "bald" ? `noch ${daysLeft(due)} Tage` : `bis ${formatDate(due)}`) : EXPIRY_LABEL.ohne}</span>;
}

export default async function PersonalPage() {
  const me = await requireUser();
  const admin = me.role === "ADMIN";

  // Mitarbeiter: nur eigene, nicht sensible Einträge – ohne Dateien
  if (!admin) {
    const docs = await db.employeeDoc.findMany({ where: { userId: me.id, kind: { notIn: [...EMP_SENSITIVE] } }, orderBy: [{ kind: "asc" }, { validUntil: "desc" }] });
    return (
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
        <div>
          <h1 className="page-title">Meine Qualifikationen</h1>
          <p className="mt-1 text-sm text-steel">Führerschein, Scheine, Unterweisungen – mit Ablaufdatum. Die Personalakte pflegt die Geschäftsführung; Neues bitte dort abgeben.</p>
        </div>
        <section className="card p-5">
          {docs.length === 0 ? <p className="text-steel">Noch nichts eingetragen.</p> : (
            <ul className="divide-y divide-line text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><strong>{d.title}</strong> <span className="text-steel">· {EMP_DOC_LABEL[d.kind as EmpDocKind]}</span></span>
                  <DueChip d={d} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  const [users, expiring] = await Promise.all([
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, passwordHash: true, funktion: true, role: true, employeeProfile: { select: { jobTitle: true, entryDate: true, exitDate: true, contractType: true, contractUntil: true, questionnaire: true } }, employeeDocs: { select: { kind: true, title: true, validUntil: true, nextCheck: true } } } }),
    expiringEmployeeDocs(),
  ]);
  // Qualifikations-Matrix: häufigste Bezeichnungen (Führerschein, Qualifikation, Unterweisung, Ersthelfer)
  const quals = [...users.flatMap((u) => u.employeeDocs.filter((d) => !EMP_SENSITIVE.includes(d.kind as EmpDocKind)).map((d) => d.title)).reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Personalakte</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-steel"><ShieldCheck className="size-4 text-brand" /> Nur für Administratoren. Verträge, Führerscheine, Qualifikationen und Vorsorge mit Ablaufwarnung per Push.</p>
      </div>

      {expiring.length > 0 && (
        <section className="card border-warn/40 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warn" /> Läuft ab oder Kontrolle fällig ({expiring.length})</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {expiring.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/personal/${d.user.id}`} className="font-medium hover:underline">{d.user.name}</Link> · {d.title} <span className="text-steel">({d.check ? "Kontrolle" : EMP_DOC_LABEL[d.kind as EmpDocKind]})</span></span>
                <DueChip d={d} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="card p-5" open={users.length < 2}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><UserPlus className="size-4 text-brand" /> Mitarbeiter anlegen</summary>
        <p className="mt-1 text-sm text-steel">Legt die Akte an – auch für Kollegen ohne Jarvis-Zugang (z. B. Monteure). Danach geht es direkt zum Personalfragebogen; Arbeitsvertrag und Ausweis kannst du in der Akte abfotografieren.</p>
        <StateForm action={newEmployeeAction} submit="Anlegen und Fragebogen ausfüllen" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input name="name" required minLength={2} maxLength={80} placeholder="Vor- und Nachname" className="input lg:col-span-2" aria-label="Name" />
          <input name="jobTitle" placeholder="Tätigkeit, z. B. Metallbauer" className="input" aria-label="Tätigkeit" />
          <label className="text-xs text-steel">Eintritt <input type="date" name="entryDate" className="input mt-1 w-full" /></label>
          <label className="text-xs text-steel">Vertragsart
            <select name="contractType" defaultValue="" className="input mt-1 w-full"><option value="">–</option>{CONTRACT_TYPES.map((c) => <option key={c} value={c}>{CONTRACT_TYPE_LABEL[c]}</option>)}</select>
          </label>
          <label className="text-xs text-steel lg:col-span-2">Funktion im Betrieb (für spätere Rechte)
            <select name="funktion" defaultValue="" className="input mt-1 w-full"><option value="">–</option>{FUNKTIONEN.map((f) => <option key={f} value={f}>{FUNKTION_LABEL[f]}</option>)}</select>
          </label>
        </StateForm>
      </details>

      <section className="card p-5">
        <h2 className="font-semibold">Team</h2>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => {
            const p = u.employeeProfile;
            const states = u.employeeDocs.map((d) => expiryState(dueOf(d)));
            const tone = states.includes("abgelaufen") ? "bg-bad" : states.includes("bald") ? "bg-warn" : "bg-ok";
            return (
              <li key={u.id}>
                <Link href={`/personal/${u.id}`} className="flex items-start gap-3 rounded-xl border border-line p-3 transition hover:border-brand/40 hover:bg-brand-soft/40">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">{u.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold">{u.name} <span className={clsx("size-2 rounded-full", tone)} /></span>
                    <span className="block text-xs text-steel">{p?.jobTitle ?? (u.funktion ? FUNKTION_LABEL[u.funktion as Funktion] : u.role === "ADMIN" ? "Administrator" : "—")}</span>
                    <span className="block text-xs text-steel">{p?.entryDate ? `seit ${formatDate(p.entryDate)}` : "Stammdaten fehlen"}{p?.exitDate ? ` · Austritt ${formatDate(p.exitDate)}` : ""}{p?.contractUntil ? ` · befristet bis ${formatDate(p.contractUntil)}` : ""}</span>
                    <span className="block text-xs text-steel">{u.employeeDocs.length} Dokumente · Fragebogen {(() => { const q = questionnaireState(readQuestionnaire(p?.questionnaire)); return q.filled === q.total ? "vollständig" : `${q.filled}/${q.total}`; })()}</span>
                    {noLogin(u) && <span className="mt-1 inline-block rounded-full bg-mist px-2 py-0.5 text-[11px] text-steel">ohne App-Zugang</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {quals.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><IdCard className="size-4 text-brand" /> Qualifikationen im Team</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="text-left text-xs text-steel"><th className="py-1 pr-3 font-medium">Mitarbeiter</th>{quals.map((q) => <th key={q} className="px-1 py-1 font-medium">{q}</th>)}</tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium">{u.name}</td>
                    {quals.map((q) => {
                      const d = u.employeeDocs.filter((x) => x.title === q).sort((a, b) => (b.validUntil?.getTime() ?? Infinity) - (a.validUntil?.getTime() ?? Infinity))[0];
                      const st = d ? expiryState(dueOf(d)) : null;
                      return <td key={q} className="px-1 py-1.5 text-center">{d ? <span className={clsx("inline-block size-3 rounded-full", st === "abgelaufen" ? "bg-bad" : st === "bald" ? "bg-warn" : "bg-ok")} title={`${q}: ${EXPIRY_LABEL[st!]}`} /> : <span className="text-line">–</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-steel">Grün = gültig, Gelb = läuft in 30 Tagen ab, Rot = abgelaufen.</p>
        </section>
      )}
    </main>
  );
}
