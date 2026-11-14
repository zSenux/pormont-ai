import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Copy, FileCode2, FileDown, FileText, Lock, Receipt, Trash2, Undo2 } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime, todayYmd } from "@/lib/berlin";
import { bookConfig, missingForInvoices } from "@/lib/buchhaltung/config";
import { customerName, deductionIds, isOverdue, readDeductions, PAYMENT_METHODS, readParty, statusText, ymdOf, openCentsOf } from "@/lib/buchhaltung/docs";
import { fmtEuroCents, fmtNum, fmtPrice, lineNetCents, readLines } from "@/lib/buchhaltung/money";
import { defaultDocMail, defaultDunningMail } from "@/lib/buchhaltung/send";
import { DUNNING_LABEL } from "@/lib/buchhaltung/pdf";
import { docLabel } from "@/lib/buchhaltung/types";
import { TONE } from "@/lib/buchhaltung/ui";
import { cancelAction, copyAction, createDunningAction, deletePaymentAction, quoteStatusAction } from "@/app/actions/buchhaltung";
import { ActionButton } from "@/components/confirm-button";
import { DocEditor } from "./editor";
import { DownPaymentForm, PaymentForm, ResultButton, SendDocForm, SendDunningForm } from "./panels";

export const dynamic = "force-dynamic";

export default async function BelegPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  const d = await db.salesDoc.findUnique({
    where: { id },
    include: { customer: true, project: { select: { id: true, name: true } }, payments: { orderBy: { day: "asc" } }, dunnings: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "desc" }, take: 40 } },
  });
  if (!d) notFound();
  const cfg = await bookConfig();
  const label = docLabel(d);
  const back = d.kind === "ANGEBOT" ? "angebote" : d.kind === "GUTSCHRIFT" ? "gutschriften" : "rechnungen";
  const related = await db.salesDoc.findMany({ where: { OR: [{ sourceId: d.id }, ...(d.sourceId ? [{ id: d.sourceId }] : [])] }, select: { id: true, kind: true, invoiceType: true, number: true, status: true } });

  if (d.status === "ENTWURF") {
    const [customers, projects, articles] = await Promise.all([
      db.customer.findMany({ where: { OR: [{ archived: false }, { id: d.customerId ?? "" }] }, orderBy: { name: "asc" }, select: { id: true, name: true, number: true, city: true, street: true, zip: true, vatId: true } }),
      db.project.findMany({ where: { OR: [{ status: { not: "FERTIG" } }, { id: d.projectId ?? "" }] }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 200 }),
      db.article.findMany({ where: { archived: false }, orderBy: { name: "asc" }, take: 1000 }),
    ]);
    const missing = d.kind !== "ANGEBOT" ? missingForInvoices(cfg) : [];
    // Für Schlussrechnungen: offene Abschläge des Kunden (alle, damit auch andere Projekte wählbar sind)
    const downPayments = d.kind === "RECHNUNG" && d.customerId
      ? (await db.salesDoc.findMany({ where: { kind: "RECHNUNG", invoiceType: "ABSCHLAG", customerId: d.customerId, status: { in: ["OFFEN", "BEZAHLT"] }, OR: [{ finalId: null }, { finalId: d.id }] }, orderBy: { date: "asc" } })).map((x) => ({ id: x.id, number: x.number!, date: ymdOf(x.date)!, title: x.title, netCents: x.netCents, taxCents: x.taxCents, grossCents: x.grossCents, paid: x.status === "BEZAHLT" }))
      : [];
    return (
      <main className="space-y-4">
        <Link href={`/buchhaltung/belege?art=${back}`} className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> {back === "angebote" ? "Angebote" : back === "gutschriften" ? "Gutschriften" : "Rechnungen"}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{label} <span className="text-steel">(Entwurf)</span></h1>
          {related.map((r) => <Link key={r.id} href={`/buchhaltung/beleg/${r.id}`} className="chip border-brand/30 bg-brand-soft text-brand">aus {docLabel(r)} {r.number ?? "Entwurf"}</Link>)}
        </div>
        {missing.length > 0 && (
          <p className="card flex items-start gap-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Vor dem Festschreiben fehlt noch: {missing.join(", ")}. {user.role === "ADMIN" ? <Link href="/buchhaltung/einstellungen" className="font-semibold underline">Jetzt eintragen</Link> : "Ein Administrator trägt das unter Buchhaltung → Einstellungen ein."}</p>
        )}
        <DocEditor
          doc={{ id: d.id, kind: d.kind, customerId: d.customerId, projectId: d.projectId, title: d.title, intro: d.intro, outro: d.outro, date: ymdOf(d.date)!, serviceFrom: ymdOf(d.serviceFrom), serviceTo: ymdOf(d.serviceTo), dueDate: ymdOf(d.dueDate), paymentDays: d.paymentDays, reverseCharge: d.reverseCharge, lines: readLines(d.lines), invoiceType: d.invoiceType as "NORMAL" | "ABSCHLAG" | "SCHLUSS", deductionIds: deductionIds(d.deductions) }}
          downPayments={downPayments}
          customers={customers.map((c) => ({ id: c.id, name: c.name, number: c.number, city: c.city, vatId: c.vatId, complete: Boolean(c.street && c.zip && c.city) }))}
          projects={projects}
          articles={articles.map((a) => ({ id: a.id, name: a.name, number: a.number, unit: a.unit, priceNet: a.priceNet, taxRate: a.taxRate, description: a.description }))}
          defaultPaymentDays={d.customer?.paymentDays ?? cfg.paymentDays}
        />
      </main>
    );
  }

  // ---------- Festgeschriebener Beleg (nur ansehen, versenden, Zahlungen, Mahnen, Storno) ----------
  const party = readParty(d.address);
  const lines = readLines(d.lines);
  const overdue = isOverdue(d);
  const open = openCentsOf(d);
  const mail = await defaultDocMail(d.id, user.name);
  const lastDunning = d.dunnings[d.dunnings.length - 1];
  const dunningMail = lastDunning && !lastDunning.sentAt ? await defaultDunningMail(lastDunning.id, user.name) : null;
  const tone = overdue ? TONE.UEBERFAELLIG : TONE[d.status];

  return (
    <main className="space-y-4">
      <Link href={`/buchhaltung/belege?art=${back}`} className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> {back === "angebote" ? "Angebote" : back === "gutschriften" ? "Gutschriften" : "Rechnungen"}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title [overflow-wrap:anywhere]">{label} {d.number}</h1>
          <p className="mt-1 text-sm text-steel">
            {d.customer ? <Link href={`/buchhaltung/kunden/${d.customer.id}`} className="text-brand">{customerName(d)}</Link> : customerName(d)}
            {" · "}{formatDate(d.date)}
            {d.project && <> · Projekt <Link href={`/projekte/${d.project.id}`} className="text-brand">{d.project.name}</Link></>}
            {d.imported && " · aus Lexware übernommen"}
            {d.finalId && <> · <Link href={`/buchhaltung/beleg/${d.finalId}`} className="text-brand">in Schlussrechnung verrechnet</Link></>}
          </p>
        </div>
        <span className={clsx("chip px-3 py-1 text-sm", tone)}>{statusText(d)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-4">
          <section className="card p-4">
            <div className="flex flex-wrap gap-2">
              {d.pdf && <a href={`/api/buchhaltung/pdf/${d.id}`} target="_blank" rel="noreferrer" className="btn-primary"><FileText className="size-4" /> PDF ansehen</a>}
              {d.pdf && <a href={`/api/buchhaltung/pdf/${d.id}?download=1`} className="btn-secondary"><FileDown className="size-4" /> Herunterladen</a>}
              {d.kind !== "ANGEBOT" && !d.imported && <a href={`/api/buchhaltung/xml/${d.id}`} className="btn-secondary"><FileCode2 className="size-4" /> XRechnung (XML)</a>}
            </div>
            {d.kind !== "ANGEBOT" && !d.imported && <p className="mt-2 text-xs text-steel">Das PDF ist eine E-Rechnung (ZUGFeRD, EN 16931): Die Rechnungsdaten stecken maschinenlesbar im PDF. Für Behörden zusätzlich die XRechnung.</p>}
            {d.imported && !d.pdf && <p className="mt-2 text-xs text-warn">Das Original-PDF aus Lexware war nicht abrufbar. Es liegt weiter in Lexware.</p>}

            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2"><dt className="text-steel">Kunde</dt><dd className="text-right">{party.name}{party.customerNo ? ` (${party.customerNo})` : ""}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-steel">Anschrift</dt><dd className="text-right">{[party.street, [party.zip, party.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "–"}</dd></div>
              {d.kind === "ANGEBOT" ? <div className="flex justify-between gap-2"><dt className="text-steel">Gültig bis</dt><dd>{formatDate(d.dueDate)}</dd></div> : <div className="flex justify-between gap-2"><dt className="text-steel">Fällig</dt><dd className={clsx(overdue && "font-semibold text-bad")}>{formatDate(d.dueDate)}</dd></div>}
              {d.kind !== "ANGEBOT" && <div className="flex justify-between gap-2"><dt className="text-steel">Leistung</dt><dd>{formatDate(d.serviceFrom ?? d.date)}{d.serviceTo && ymdOf(d.serviceTo) !== ymdOf(d.serviceFrom) ? ` – ${formatDate(d.serviceTo)}` : ""}</dd></div>}
              {d.reverseCharge && <div className="flex justify-between gap-2 sm:col-span-2"><dt className="text-steel">Steuer</dt><dd>§ 13b UStG – Kunde schuldet die USt.</dd></div>}
              {d.sentAt && <div className="flex justify-between gap-2 sm:col-span-2"><dt className="text-steel">Zuletzt gesendet</dt><dd>{formatDateTime(d.sentAt)} an {d.sentTo}</dd></div>}
            </dl>
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">{d.title || "Positionen"}</h2>
            <ul className="mt-2 divide-y divide-line">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-3 py-2 text-sm">
                  <span className="w-5 shrink-0 text-steel">{i + 1}.</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-medium">{l.name}</span>{l.description && <span className="block whitespace-pre-line text-xs text-steel">{l.description}</span>}<span className="block text-xs text-steel">{fmtNum(l.qty)} {l.unit} × {fmtPrice(l.price)}{l.discount ? ` − ${fmtNum(l.discount, 2)} %` : ""}{!d.reverseCharge ? ` · ${l.taxRate} % USt.` : ""}</span></span>
                  <span className="shrink-0 font-semibold">{fmtEuroCents(lineNetCents(l))}</span>
                </li>
              ))}
            </ul>
            <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-steel">Netto</dt><dd>{fmtEuroCents(d.netCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-steel">USt.</dt><dd>{fmtEuroCents(d.taxCents)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 font-bold"><dt>Brutto</dt><dd>{fmtEuroCents(d.grossCents)}</dd></div>
              {readDeductions(d.deductions).map((x) => <div key={x.id} className="flex justify-between"><dt className="text-steel">abzgl. <Link href={`/buchhaltung/beleg/${x.id}`} className="text-brand">Abschlag {x.number}</Link></dt><dd>− {fmtEuroCents(x.grossCents)}</dd></div>)}
              {d.prepaidCents > 0 && <div className="flex justify-between border-t border-line pt-1 font-bold"><dt>Zu zahlen</dt><dd>{fmtEuroCents(d.grossCents - d.prepaidCents)}</dd></div>}
              {d.kind === "RECHNUNG" && d.paidCents > 0 && <div className="flex justify-between text-ok"><dt>bezahlt</dt><dd>{fmtEuroCents(d.paidCents)}</dd></div>}
              {d.kind === "RECHNUNG" && d.status === "OFFEN" && <div className="flex justify-between font-semibold text-warn"><dt>offen</dt><dd>{fmtEuroCents(open)}</dd></div>}
            </dl>
          </section>

          {d.status !== "STORNIERT" && d.pdf && (
            <details className="card p-4" open={!d.sentAt}>
              <summary className="cursor-pointer font-semibold">{d.sentAt ? "Erneut per Mail senden" : `${label} per Mail senden`}</summary>
              <div className="mt-3"><SendDocForm docId={d.id} d={mail} xmlOption={d.kind !== "ANGEBOT" && !d.imported} label={`${label} senden`} /></div>
            </details>
          )}

          {d.kind === "RECHNUNG" && (d.status === "OFFEN" || d.status === "BEZAHLT") && (
            <section className="card space-y-3 p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Receipt className="size-4 text-brand" /> Zahlungen</h2>
              {d.payments.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1">{formatDate(p.day)} · {PAYMENT_METHODS[p.method] ?? p.method}{p.note ? ` · ${p.note}` : ""}{p.userName ? <span className="text-xs text-steel"> · {p.userName}</span> : null}</span>
                      <span className="font-semibold">{fmtEuroCents(p.amountCents)}</span>
                      <ActionButton action={deletePaymentAction.bind(null, p.id)} confirm="Zahlung löschen?" className="rounded-lg p-1 text-steel hover:text-bad" title="Zahlung löschen"><Trash2 className="size-4" /></ActionButton>
                    </li>
                  ))}
                </ul>
              )}
              {d.status === "OFFEN" && <PaymentForm docId={d.id} openEuro={open / 100} today={todayYmd()} />}
            </section>
          )}

          {d.kind === "RECHNUNG" && (d.dunnings.length > 0 || overdue) && (
            <section className="card space-y-3 p-4">
              <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-bad" /> Mahnwesen</h2>
              {d.dunnings.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {d.dunnings.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <a href={`/api/buchhaltung/mahnung/${m.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand">{DUNNING_LABEL[m.level]}</a>
                      <span className="text-steel">vom {formatDate(m.day)} · Frist {formatDate(m.dueDate)}{m.feeCents ? ` · Gebühr ${fmtEuroCents(m.feeCents)}` : ""}</span>
                      <span className="ml-auto text-xs text-steel">{m.sentAt ? `gesendet ${formatDate(m.sentAt)}` : "noch nicht gesendet"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {dunningMail && lastDunning && <div className="rounded-2xl border border-line p-3"><p className="mb-2 text-sm font-medium">{DUNNING_LABEL[lastDunning.level]} senden</p><SendDunningForm dunningId={lastDunning.id} d={dunningMail} /></div>}
              {overdue && d.dunningLevel < 3 && (!lastDunning || lastDunning.sentAt) && (
                <ResultButton action={createDunningAction.bind(null, d.id)} className="btn-primary">{DUNNING_LABEL[d.dunningLevel + 1]} erstellen</ResultButton>
              )}
            </section>
          )}

          {d.kind === "ANGEBOT" && (
            <details className="card p-4">
              <summary className="cursor-pointer font-semibold">Abschlagsrechnung zu diesem Angebot</summary>
              <p className="mt-2 text-sm text-steel">Für größere Aufträge: Teilbetrag vorab berechnen. Am Ende über „Schlussrechnung“ alles abrechnen – die Abschläge werden automatisch abgezogen.</p>
              <div className="mt-3"><DownPaymentForm quoteId={d.id} /></div>
            </details>
          )}

          <section className="card flex flex-wrap gap-2 p-4">
            {d.kind === "ANGEBOT" && <ResultButton action={copyAction.bind(null, d.id, "RECHNUNG", "NORMAL")} className="btn-primary"><Receipt className="size-4" /> In Rechnung umwandeln</ResultButton>}
            {d.kind === "ANGEBOT" && <ResultButton action={copyAction.bind(null, d.id, "RECHNUNG", "SCHLUSS")}><Receipt className="size-4" /> Schlussrechnung</ResultButton>}
            {d.kind === "ANGEBOT" && d.status !== "ANGENOMMEN" && <ResultButton action={quoteStatusAction.bind(null, d.id, "ANGENOMMEN")}>Angenommen</ResultButton>}
            {d.kind === "ANGEBOT" && d.status !== "ABGELEHNT" && <ResultButton action={quoteStatusAction.bind(null, d.id, "ABGELEHNT")}>Abgelehnt</ResultButton>}
            {d.kind === "ANGEBOT" && d.status !== "OFFEN" && <ResultButton action={quoteStatusAction.bind(null, d.id, "OFFEN")}>Wieder offen</ResultButton>}
            {d.kind !== "GUTSCHRIFT" && <ResultButton action={copyAction.bind(null, d.id, d.kind)}><Copy className="size-4" /> Kopieren</ResultButton>}
            {d.kind === "RECHNUNG" && d.status !== "STORNIERT" && (
              <ResultButton action={cancelAction.bind(null, d.id)} confirm={`Rechnung ${d.number} stornieren?\n\nEs wird eine Storno-Gutschrift mit eigener Nummer erstellt. Die Rechnung bleibt im Archiv und gilt als storniert. Danach kannst du eine neue, korrigierte Rechnung schreiben (z. B. über „Kopieren“).`} className="btn-danger"><Undo2 className="size-4" /> Stornieren</ResultButton>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          {related.length > 0 && (
            <section className="card p-4">
              <h2 className="font-semibold">Zugehörig</h2>
              <ul className="mt-2 space-y-1 text-sm">{related.map((r) => <li key={r.id}><Link href={`/buchhaltung/beleg/${r.id}`} className="text-brand">{docLabel(r)} {r.number ?? "(Entwurf)"}</Link></li>)}</ul>
            </section>
          )}
          <section className="card p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Lock className="size-4 text-brand" /> Verlauf</h2>
            <p className="mt-1 text-xs text-steel">Festgeschrieben {formatDateTime(d.finalizedAt)}{d.finalizedBy ? ` von ${d.finalizedBy}` : ""}. Der Beleg ist unveränderlich (GoBD).</p>
            <ul className="mt-3 space-y-2 text-sm">
              {d.events.map((e) => (
                <li key={e.id}><span className="block text-xs text-steel">{formatDateTime(e.createdAt)}{e.userName ? ` · ${e.userName}` : ""}</span>{e.text}</li>
              ))}
            </ul>
            {d.sha256 && <p className="mt-3 break-all text-[10px] text-steel">Prüfsumme PDF (SHA-256): {d.sha256}</p>}
          </section>
        </aside>
      </div>
    </main>
  );
}
