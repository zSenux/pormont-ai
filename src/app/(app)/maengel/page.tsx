import Link from "next/link";
import { AlertTriangle, Camera, Plus, ShieldCheck } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { warrantyList } from "@/lib/maengel";
import { DEFECT_OPEN, DEFECT_STATUS_LABEL, DEFECT_TONE, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, SOURCE_LABEL, SOURCES, type DefectStatus, type Severity } from "@/lib/maengel-shared";
import { newDefect, setWarrantyUntil } from "@/app/actions/maengel";
import { StateForm } from "@/components/state-form";

export const metadata = { title: "Mängel" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "offen", label: "Offen" },
  { key: "meine", label: "Mir zugewiesen" },
  { key: "pruefen", label: "Zu prüfen" },
  { key: "gewaehrleistung", label: "Gewährleistung" },
  { key: "alle", label: "Alle" },
];

export default async function MaengelPage({ searchParams }: { searchParams: Promise<{ filter?: string; projekt?: string; ansicht?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = sp.ansicht === "gewaehrleistung" ? "gewaehrleistung" : (sp.filter ?? "offen");
  const where = {
    ...(sp.projekt ? { projectId: sp.projekt } : {}),
    ...(filter === "offen" ? { status: { in: DEFECT_OPEN } } : filter === "meine" ? { assigneeId: me.id, status: { in: DEFECT_OPEN } } : filter === "pruefen" ? { status: "BEHOBEN" } : filter === "gewaehrleistung" ? { warranty: true } : {}),
  };
  const [list, projects, users, counts, warranties] = await Promise.all([
    db.defect.findMany({ where, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 300, include: { project: { select: { id: true, name: true } }, assignee: { select: { name: true } }, _count: { select: { files: true } } } }),
    db.project.findMany({ where: { OR: [{ status: { not: "FERTIG" } }, { warrantyUntil: { gte: new Date() } }, { assemblies: { some: { signedAt: { not: null } } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.defect.groupBy({ by: ["status"], _count: true }),
    filter === "gewaehrleistung" ? warrantyList() : Promise.resolve([]),
  ]);
  const today = todayYmd();
  const count = (s: DefectStatus) => counts.find((c) => c.status === s)?._count ?? 0;
  const late = list.filter((d) => d.dueDate && DEFECT_OPEN.includes(d.status as DefectStatus) && berlinParts(d.dueDate).ymd < today).length;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Mängel</h1>
        <p className="mt-1 text-sm text-steel">Mängel mit Foto erfassen, zuweisen, beheben und abhaken – mit Gewährleistung je Projekt. Oder Jarvis sagen: „Neuer Mangel bei der Treppe Käfertal: Schweißnaht am Podest nacharbeiten.“</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Offen", v: count("OFFEN"), t: "text-bad" },
          { l: "In Arbeit", v: count("IN_ARBEIT"), t: "text-warn" },
          { l: "Behoben – prüfen", v: count("BEHOBEN"), t: "text-brand" },
          { l: "Überfällig (Liste)", v: late, t: late ? "text-bad" : "text-ok" },
        ].map((k) => (
          <div key={k.l} className="card p-4">
            <p className="text-xs text-steel">{k.l}</p>
            <p className={clsx("text-2xl font-extrabold", k.t)}>{k.v}</p>
          </div>
        ))}
      </div>

      <details className="card p-4" open={Boolean(sp.projekt)}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Plus className="size-4 text-brand" /> Mangel erfassen</summary>
        <StateForm action={newDefect} className="mt-3 grid gap-2 sm:grid-cols-2" submit={<><Camera className="size-4" /> Anlegen – danach Foto machen</>}>
          <select name="projectId" required defaultValue={sp.projekt ?? ""} className="input sm:col-span-2" aria-label="Projekt">
            <option value="" disabled>Projekt / Baustelle</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input name="title" required minLength={3} placeholder="Was ist der Mangel? z. B. „Schweißnaht Podest links nacharbeiten“" className="input sm:col-span-2" aria-label="Mangel" />
          <input name="location" placeholder="Ort/Bauteil, z. B. „Treppe EG, Podest“" className="input" aria-label="Ort" />
          <select name="severity" defaultValue="MITTEL" className="input" aria-label="Schwere">
            {SEVERITIES.map((s) => <option key={s} value={s}>Schwere: {SEVERITY_LABEL[s]}</option>)}
          </select>
          <select name="assigneeId" defaultValue="" className="input" aria-label="Zuständig">
            <option value="">Zuständig: Projektleitung</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select name="source" defaultValue="" className="input" aria-label="Herkunft">
            <option value="">Herkunft: automatisch</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
          <label className="text-xs text-steel">Frist (leer = nach Schwere: 3/10/21 Tage)<input name="dueDate" type="date" className="input mt-1" /></label>
          <textarea name="description" rows={2} placeholder="Beschreibung (optional)" className="input sm:col-span-2" aria-label="Beschreibung" />
        </StateForm>
      </details>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/maengel?filter=${f.key}${sp.projekt ? `&projekt=${sp.projekt}` : ""}`} className={clsx("chip px-3 py-1", filter === f.key ? "border-brand bg-brand text-white" : "bg-white text-steel")}>{f.label}</Link>
        ))}
        {sp.projekt && <Link href="/maengel" className="chip bg-white px-3 py-1 text-steel">Alle Projekte ✕</Link>}
      </div>

      {filter === "gewaehrleistung" && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand" /> Gewährleistung je Projekt</h2>
          <p className="mt-1 text-xs text-steel">Beginn mit der Abnahme (Unterschrift im Montage-Protokoll), Dauer {process.env.GEWAEHRLEISTUNG_JAHRE ?? 5} Jahre – oder Ende von Hand setzen (z. B. VOB/B 4 Jahre). 90 Tage vor Ablauf erinnert Jarvis an die Begehung.</p>
          <ul className="mt-3 divide-y divide-line">
            {warranties.length === 0 && <li className="py-3 text-sm text-steel">Noch keine abgenommenen Projekte.</li>}
            {warranties.map((w) => {
              const days = Math.ceil((w.until!.getTime() - Date.now()) / 86400_000);
              return (
                <li key={w.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/projekte/${w.id}`} className="font-medium text-brand">{w.name}</Link>
                    <p className="text-xs text-steel">{w.acceptedAt ? `Abnahme ${formatDate(w.acceptedAt)} · ` : ""}Gewährleistung bis {formatDate(w.until)}{w.manual ? " (von Hand)" : ""} · {w._count.defects} Gewährleistungsfälle</p>
                  </div>
                  <span className={clsx("chip", days < 0 ? "border-line bg-mist text-steel" : days <= 90 ? "border-amber-200 bg-amber-50 text-warn" : "border-emerald-200 bg-emerald-50 text-ok")}>{days < 0 ? "abgelaufen" : `noch ${days} Tage`}</span>
                  <form action={setWarrantyUntil.bind(null, w.id)} className="flex gap-1">
                    <input type="date" name="until" className="input w-36 py-1.5 text-xs" aria-label={`Gewährleistung bis ${w.name}`} />
                    <button className="btn-secondary px-3 py-1.5 text-xs">Setzen</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card divide-y divide-line">
        {list.length === 0 && <p className="p-5 text-sm text-steel">Keine Mängel in dieser Ansicht. 👍</p>}
        {list.map((d) => {
          const overdue = d.dueDate && DEFECT_OPEN.includes(d.status as DefectStatus) && berlinParts(d.dueDate).ymd < today;
          return (
            <Link key={d.id} href={`/maengel/${d.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-mist/60">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <span className="text-steel">{d.number}</span> {d.title}
                </p>
                <p className="text-xs text-steel">
                  {d.project.name}{d.location && ` · ${d.location}`} · <span className={SEVERITY_TONE[d.severity as Severity]}>{SEVERITY_LABEL[d.severity as Severity]}</span>
                  {d.assignee ? ` · ${d.assignee.name}` : " · Projektleitung"}{d._count.files ? ` · 📷 ${d._count.files}` : ""}{d.warranty ? " · Gewährleistung" : ""}
                </p>
              </div>
              {d.dueDate && <span className={clsx("flex items-center gap-1 text-xs", overdue ? "font-semibold text-bad" : "text-steel")}>{overdue && <AlertTriangle className="size-3.5" />}bis {formatDate(d.dueDate)}</span>}
              <span className={clsx("chip", DEFECT_TONE[d.status as DefectStatus])}>{DEFECT_STATUS_LABEL[d.status as DefectStatus]}</span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
