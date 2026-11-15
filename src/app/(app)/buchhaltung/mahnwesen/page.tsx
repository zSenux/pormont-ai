import Link from "next/link";
import { BellRing, FileText, Mail, PauseCircle, Printer, ShieldCheck } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { customerName } from "@/lib/buchhaltung/docs";
import { fmtEuroCents } from "@/lib/buchhaltung/money";
import { DUNNING_LABEL } from "@/lib/buchhaltung/pdf";
import { dunningProposals, PROPOSAL_LABEL, type Proposal, type ProposalState } from "@/lib/buchhaltung/mahnwesen";
import { noDunningAction, pauseDunningAction, releaseAllAction, releaseDunningAction } from "@/app/actions/mahnwesen";
import { ResultButton } from "@/components/result-button";
import { ActionButton } from "@/components/confirm-button";

export const metadata = { title: "Mahnwesen" };
export const dynamic = "force-dynamic";

const TONE: Record<ProposalState, string> = {
  faellig: "border-bad/30 bg-red-50 text-bad",
  ungesendet: "border-warn/30 bg-amber-50 text-warn",
  bald: "border-line bg-mist text-steel",
  pausiert: "border-line bg-mist text-steel",
  gesperrt: "border-line bg-mist text-steel",
  ausgereizt: "border-bad/30 bg-red-50 text-bad",
  klein: "border-line bg-mist text-steel",
};
const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

function Row({ p, admin }: { p: Proposal; admin: boolean }) {
  const releasable = ["faellig", "ungesendet", "bald", "pausiert"].includes(p.state);
  const label = p.state === "ungesendet" ? `${DUNNING_LABEL[p.level]} senden` : `${DUNNING_LABEL[p.nextLevel]} senden`;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium"><Link href={`/buchhaltung/beleg/${p.doc.id}`} className="hover:underline">{p.doc.number}</Link> · {customerName(p.doc)}</p>
        <p className="text-xs text-steel">
          offen <strong className="text-ink">{fmtEuroCents(p.open)}</strong> · fällig war {formatDate(p.doc.dueDate)} ({p.overdueDays} Tage) · bisher: {p.level ? DUNNING_LABEL[p.level] : "keine Mahnung"}{p.last?.sentAt ? ` am ${formatDate(p.last.sentAt)}` : ""}
          {p.state === "bald" && ` · ${DUNNING_LABEL[p.nextLevel]} ab ${formatDate(ymdDate(p.nextDue))}`}
          {p.state === "pausiert" && ` · zurückgestellt bis ${formatDate(p.doc.dunningPausedUntil)}${p.doc.dunningPauseNote ? ` („${p.doc.dunningPauseNote}“)` : ""}`}
          {!p.email && " · keine E-Mail beim Kunden"}
        </p>
      </div>
      <span className={clsx("chip", TONE[p.state])}>{PROPOSAL_LABEL[p.state]}</span>
      {p.state === "ausgereizt" && <span className="text-xs text-steel">Inkasso oder gerichtliches Mahnverfahren prüfen</span>}
      {admin && releasable && (
        <div className="flex flex-wrap items-start gap-1">
          {p.email && <ResultButton action={releaseDunningAction.bind(null, p.doc.id, "mail")} confirm={`${label} an ${p.email} senden?`} className="btn-primary px-3 py-1.5 text-xs"><Mail className="size-3.5" /> Freigeben & senden</ResultButton>}
          <ResultButton action={releaseDunningAction.bind(null, p.doc.id, "post")} confirm={`${DUNNING_LABEL[p.state === "ungesendet" ? p.level : p.nextLevel]} als PDF für die Post erstellen?`} className="btn-secondary px-3 py-1.5 text-xs"><Printer className="size-3.5" /> Per Post</ResultButton>
        </div>
      )}
      {p.last && <a href={`/api/buchhaltung/mahnung/${p.last.id}`} target="_blank" className="btn-secondary px-2 py-1.5 text-xs" title="Letzte Mahnung (PDF)"><FileText className="size-3.5" /></a>}
      {releasable && p.state !== "pausiert" && (
        <form action={pauseDunningAction.bind(null, p.doc.id)} className="flex gap-1">
          <select name="days" defaultValue="14" className="input py-1 text-xs" aria-label="Zurückstellen um">
            <option value="7">7 Tage</option><option value="14">14 Tage</option><option value="30">30 Tage</option>
          </select>
          <input name="note" placeholder="Grund" className="input w-28 py-1 text-xs" aria-label="Grund" />
          <button className="btn-secondary px-2 py-1 text-xs" title="Zurückstellen"><PauseCircle className="size-3.5" /></button>
        </form>
      )}
      {admin && p.doc.customer && (
        <ActionButton action={noDunningAction.bind(null, p.doc.customer.id, !p.doc.customer.noDunning)} className="text-xs text-steel underline">{p.doc.customer.noDunning ? "Kunde wieder mahnen" : "Kunde nie mahnen"}</ActionButton>
      )}
    </li>
  );
}

export default async function Mahnwesen() {
  const me = await requireUser();
  const admin = me.role === "ADMIN";
  const { cfg, items, due } = await dunningProposals();
  const recent = await db.dunning.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { doc: { select: { id: true, number: true, address: true, customer: { select: { name: true } } } } } });
  const sum = due.reduce((t, p) => t + p.open, 0);
  const groups: { title: string; states: ProposalState[] }[] = [
    { title: "Zur Freigabe", states: ["faellig", "ungesendet"] },
    { title: "Demnächst fällig", states: ["bald"] },
    { title: "Nach der 2. Mahnung", states: ["ausgereizt"] },
    { title: "Zurückgestellt / nicht mahnen", states: ["pausiert", "gesperrt", "klein"] },
  ];

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center gap-4 p-5">
        <BellRing className="size-8 text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{due.length ? `${due.length} ${due.length === 1 ? "Mahnung wartet" : "Mahnungen warten"} auf Freigabe · ${fmtEuroCents(sum)}` : "Keine Mahnung fällig"}</h2>
          <p className="text-sm text-steel">
            Jarvis schlägt die nächste Stufe vor: Zahlungserinnerung {cfg.reminderAfterDays} Tage nach Fälligkeit, 1. und 2. Mahnung {cfg.nextLevelAfterDays} Tage nach Ablauf der Mahnfrist ({cfg.dunningDays} Tage).
            {cfg.autoDunning ? " Die Geschäftsführung bekommt werktags eine Push-Nachricht." : " Push-Hinweise sind ausgeschaltet."}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-steel"><ShieldCheck className="size-3.5 text-ok" /> Gesendet wird nichts automatisch – nur nach Freigabe durch einen Administrator.{admin ? "" : " Du kannst Mahnungen zurückstellen; freigeben darf die Geschäftsführung."}</p>
        </div>
        {admin && due.filter((p) => p.email).length > 1 && (
          <ResultButton action={releaseAllAction.bind(null, due.filter((p) => p.email).map((p) => p.doc.id))} confirm={`${due.filter((p) => p.email).length} Mahnungen jetzt per E-Mail senden?`} className="btn-primary"><Mail className="size-4" /> Alle freigeben</ResultButton>
        )}
      </section>

      {groups.map((g) => {
        const list = items.filter((p) => g.states.includes(p.state));
        if (!list.length) return null;
        return (
          <section key={g.title} className="card p-5">
            <h3 className="font-semibold">{g.title} ({list.length})</h3>
            <ul className="mt-1 divide-y divide-line">{list.map((p) => <Row key={p.doc.id} p={p} admin={admin} />)}</ul>
          </section>
        );
      })}

      <section className="card p-5">
        <h3 className="font-semibold">Zuletzt erstellt</h3>
        {recent.length === 0 ? <p className="mt-1 text-sm text-steel">Noch keine Mahnungen.</p> : (
          <ul className="mt-1 divide-y divide-line text-sm">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{formatDate(d.day)} · {DUNNING_LABEL[d.level]} · <Link href={`/buchhaltung/beleg/${d.doc.id}`} className="hover:underline">{d.doc.number}</Link> · {customerName(d.doc)} · {fmtEuroCents(d.openCents + d.feeCents)}</span>
                <span className="flex items-center gap-2 text-xs text-steel">{d.sentAt ? `gesendet an ${d.sentTo}` : "nicht per Mail gesendet"}<a href={`/api/buchhaltung/mahnung/${d.id}`} target="_blank" className="btn-secondary px-2 py-1"><FileText className="size-3.5" /></a></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {admin && <p className="text-xs text-steel">Fristen und Gebühren unter <Link href="/buchhaltung/einstellungen" className="underline">Buchhaltung → Einstellungen</Link>.</p>}
    </div>
  );
}
