import { CheckCircle2, Circle, CircleDashed, CircleDot, Flag, ListChecks, Trash2, UserRound, Users } from "lucide-react";
import { clsx } from "clsx";
import { db } from "@/lib/db";
import { berlinParts, formatDate } from "@/lib/berlin";
import { currentPhase, progressOf, projectPhases } from "@/lib/phases";
import { PHASES, PHASE_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, type PhaseStatus, type Priority } from "@/lib/phases-shared";
import { addMember, addMilestone, addProjectTask, deleteMilestone, removeMember, savePhase, setLeader, setPhaseStatus, toggleMilestone } from "@/app/actions/planung";
import { toggleTask } from "@/app/actions";
import { ActionButton } from "@/components/confirm-button";
import { ProgressBar } from "@/components/progress-bar";

const ymdOf = (d: Date | null) => (d ? berlinParts(d).ymd : "");
const title = (key: string) => PHASES.find((p) => p.key === key)?.title ?? key;

const ICON: Record<PhaseStatus, typeof Circle> = { OFFEN: Circle, LAEUFT: CircleDot, ERLEDIGT: CheckCircle2, ENTFAELLT: CircleDashed };
const TONE: Record<PhaseStatus, string> = { OFFEN: "text-steel/60", LAEUFT: "text-brand", ERLEDIGT: "text-ok", ENTFAELLT: "text-steel/40" };

/** Projektplanung: Phasen-Ablauf, Meilensteine, Projektleiter + Team, Projektaufgaben */
export async function ProjectPlan({ projectId, leaderId }: { projectId: string; leaderId: string | null }) {
  const [phases, milestones, members, tasks, users] = await Promise.all([
    projectPhases(projectId),
    db.projectMilestone.findMany({ where: { projectId }, orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueDate: { sort: "asc", nulls: "last" } }] }),
    db.projectMember.findMany({ where: { projectId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.task.findMany({ where: { projectId }, orderBy: [{ doneAt: { sort: "desc", nulls: "first" } }, { dueAt: { sort: "asc", nulls: "last" } }], take: 50, include: { assignee: { select: { name: true } } } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pct = progressOf(phases);
  const cur = currentPhase(phases);
  const now = new Date();

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="card space-y-4 p-5">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <ListChecks className="size-4 text-brand" /> Projektablauf
            <span className="ml-auto text-sm font-normal text-steel">{pct} % · {cur ? `jetzt: ${title(cur.key)}` : "abgeschlossen"}</span>
          </h2>
          <ProgressBar pct={pct} />
        </div>
        <ol className="divide-y divide-line">
          {phases.map((ph) => {
            const st = ph.status as PhaseStatus;
            const Icon = ICON[st] ?? Circle;
            const late = st !== "ERLEDIGT" && st !== "ENTFAELLT" && ph.endDate && ph.endDate < now;
            return (
              <li key={ph.id} className="py-2">
                <div className="flex items-center gap-2">
                  <Icon className={clsx("size-5 shrink-0", TONE[st])} />
                  <div className="min-w-0 flex-1">
                    <p className={clsx("text-sm font-medium", st === "ENTFAELLT" && "text-steel line-through")}>{ph.sort}. {title(ph.key)}</p>
                    <p className={clsx("text-xs", late ? "text-bad" : "text-steel")}>
                      {[
                        PHASE_STATUS_LABEL[st],
                        (ph.startDate || ph.endDate) && `${ph.startDate ? formatDate(ph.startDate) : "?"} – ${ph.endDate ? formatDate(ph.endDate) : "?"}`,
                        late && "Termin überschritten",
                        ph.doneAt && `erledigt ${formatDate(ph.doneAt)}${ph.doneByName ? ` (${ph.doneByName})` : ""}`,
                        ph.note,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {st === "OFFEN" && <ActionButton action={setPhaseStatus.bind(null, projectId, ph.key, "LAEUFT")} className="chip px-2 py-0.5 text-xs">Starten</ActionButton>}
                    {(st === "OFFEN" || st === "LAEUFT") && <ActionButton action={setPhaseStatus.bind(null, projectId, ph.key, "ERLEDIGT")} className="chip border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-ok">Erledigt</ActionButton>}
                    {(st === "ERLEDIGT" || st === "ENTFAELLT") && <ActionButton action={setPhaseStatus.bind(null, projectId, ph.key, "OFFEN")} className="chip px-2 py-0.5 text-xs text-steel">Zurücksetzen</ActionButton>}
                  </div>
                </div>
                <details className="ml-7 mt-1">
                  <summary className="cursor-pointer text-xs text-brand">Termin & Notiz</summary>
                  <form action={savePhase.bind(null, projectId, ph.key)} className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-steel">Beginn<input name="start" type="date" defaultValue={ymdOf(ph.startDate)} className="input mt-1 w-full" /></label>
                    <label className="text-xs text-steel">Ende<input name="ende" type="date" defaultValue={ymdOf(ph.endDate)} className="input mt-1 w-full" /></label>
                    <input name="note" defaultValue={ph.note ?? ""} placeholder="Notiz (optional)" className="input col-span-2" aria-label="Notiz" />
                    <div className="col-span-2 flex justify-between gap-2">
                      {st !== "ENTFAELLT" ? (
                        <ActionButton action={setPhaseStatus.bind(null, projectId, ph.key, "ENTFAELLT")} className="text-xs text-steel hover:text-ink">Phase entfällt</ActionButton>
                      ) : <span />}
                      <button className="btn-secondary">Speichern</button>
                    </div>
                  </form>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="space-y-5">
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4 text-brand" /> Projektleiter & Team</h2>
          <form action={setLeader.bind(null, projectId)} className="flex gap-2">
            <select name="leaderId" defaultValue={leaderId ?? ""} className="input min-w-0 flex-1" aria-label="Projektleiter">
              <option value="">– Projektleiter wählen –</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn-secondary">Setzen</button>
          </form>
          <ul className="space-y-1 text-sm">
            {members.length === 0 && <li className="text-steel">Noch niemand im Team.</li>}
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <UserRound className="size-4 text-steel" />
                <span className="min-w-0 flex-1 truncate">{m.user.name}{m.role && <span className="text-steel"> · {m.role}</span>}</span>
                <ActionButton action={removeMember.bind(null, m.id)} className="text-steel/60 hover:text-bad" title="Aus dem Team nehmen"><Trash2 className="size-3.5" /></ActionButton>
              </li>
            ))}
          </ul>
          <form action={addMember.bind(null, projectId)} className="grid grid-cols-2 gap-2">
            <select name="userId" required className="input" aria-label="Mitarbeiter" defaultValue="">
              <option value="" disabled>Mitarbeiter</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input name="role" placeholder="Aufgabe, z. B. Montage" className="input" aria-label="Aufgabe im Projekt" />
            <button className="btn-secondary col-span-2">Ins Team aufnehmen</button>
          </form>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" /> Meilensteine</h2>
          <ul className="space-y-1 text-sm">
            {milestones.length === 0 && <li className="text-steel">Noch keine Meilensteine.</li>}
            {milestones.map((m) => {
              const late = !m.doneAt && m.dueDate && m.dueDate < now;
              return (
                <li key={m.id} className="flex items-center gap-2">
                  <ActionButton action={toggleMilestone.bind(null, m.id)} className={clsx("grid size-5 shrink-0 place-items-center rounded-full border-2", m.doneAt ? "border-ok bg-ok text-white" : "border-line hover:border-brand")} title={m.doneAt ? "Wieder öffnen" : "Erreicht"}>
                    {m.doneAt ? <CheckCircle2 className="size-3" /> : null}
                  </ActionButton>
                  <span className={clsx("min-w-0 flex-1 truncate", m.doneAt && "text-steel line-through")}>{m.title}</span>
                  {m.dueDate && <span className={clsx("text-xs", late ? "font-semibold text-bad" : "text-steel")}>{formatDate(m.dueDate)}</span>}
                  <ActionButton action={deleteMilestone.bind(null, m.id)} confirm="Meilenstein löschen?" className="text-steel/60 hover:text-bad" title="Löschen"><Trash2 className="size-3.5" /></ActionButton>
                </li>
              );
            })}
          </ul>
          <form action={addMilestone.bind(null, projectId)} className="grid grid-cols-3 gap-2">
            <input name="title" required minLength={2} placeholder="z. B. Freigabe Werkplanung" className="input col-span-2" aria-label="Meilenstein" />
            <input name="date" type="date" className="input" aria-label="Datum" />
            <button className="btn-secondary col-span-3">Meilenstein anlegen</button>
          </form>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ListChecks className="size-4 text-brand" /> Aufgaben im Projekt</h2>
          <ul className="space-y-1 text-sm">
            {tasks.length === 0 && <li className="text-steel">Keine Aufgaben.</li>}
            {tasks.map((t) => {
              const late = !t.doneAt && t.dueAt && t.dueAt < now;
              const prio = (t.priority as Priority) ?? "NORMAL";
              return (
                <li key={t.id} className="flex items-center gap-2">
                  <ActionButton action={toggleTask.bind(null, t.id)} className={clsx("grid size-5 shrink-0 place-items-center rounded-full border-2", t.doneAt ? "border-ok bg-ok text-white" : "border-line hover:border-brand")} title={t.doneAt ? "Wieder öffnen" : "Erledigt"}>
                    {t.doneAt ? <CheckCircle2 className="size-3" /> : null}
                  </ActionButton>
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block truncate", t.doneAt && "text-steel line-through")}>{t.title}</span>
                    <span className={clsx("block text-xs", late ? "text-bad" : "text-steel")}>{[t.assignee?.name, t.dueAt && `fällig ${formatDate(t.dueAt)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  {prio !== "NORMAL" && <span className={clsx("chip px-2 py-0.5 text-[11px]", PRIORITY_TONE[prio])}>{PRIORITY_LABEL[prio]}</span>}
                </li>
              );
            })}
          </ul>
          <form action={addProjectTask.bind(null, projectId)} className="grid grid-cols-2 gap-2">
            <input name="title" required placeholder="Aufgabe, z. B. Aufmaß vor Ort" className="input col-span-2" aria-label="Aufgabe" />
            <select name="assigneeId" className="input" aria-label="Verantwortlich" defaultValue="">
              <option value="">Verantwortlich</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select name="priority" className="input" aria-label="Priorität" defaultValue="NORMAL">
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <input name="date" type="date" className="input" aria-label="Fällig am" />
            <button className="btn-secondary">Anlegen</button>
          </form>
        </section>
      </div>
    </div>
  );
}
