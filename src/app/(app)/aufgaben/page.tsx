import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { addTask } from "@/app/actions";
import { TaskRow } from "./task-row";

export const metadata = { title: "Aufgaben" };
export const dynamic = "force-dynamic";

export default async function AufgabenPage() {
  await requireUser();
  const [open, done] = await Promise.all([
    db.task.findMany({ where: { doneAt: null }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { createdBy: { select: { name: true } } } }),
    db.task.findMany({ where: { doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: 15 }),
  ]);
  const now = new Date();
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Aufgaben</h1>
        <p className="mt-1 text-sm text-steel">Mit Uhrzeit gibt es eine Push-Erinnerung. Oder einfach Jarvis sagen: „Erinnere mich Freitag um 14 Uhr an …“</p>
      </div>
      <form action={addTask} className="card flex flex-wrap gap-2 p-3">
        <input name="title" required placeholder="Neue Aufgabe …" className="input min-w-0 flex-[2_1_220px]" aria-label="Aufgabe" />
        <input name="date" type="date" className="input flex-[1_1_140px]" aria-label="Datum" />
        <input name="time" type="time" className="input flex-[1_1_100px]" aria-label="Uhrzeit" />
        <button className="btn-primary">
          <Plus className="size-4" /> Anlegen
        </button>
      </form>
      <ul className="card divide-y divide-line">
        {open.length === 0 && <li className="p-5 text-sm text-steel">Keine offenen Aufgaben.</li>}
        {open.map((t) => (
          <TaskRow key={t.id} id={t.id} title={t.title} done={false} due={t.dueAt ? (t.dueHasTime ? formatDateTime(t.dueAt) : formatDate(t.dueAt)) : null} overdue={Boolean(t.dueAt && t.dueAt < now)} by={t.createdBy?.name ?? null} />
        ))}
      </ul>
      {done.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-steel">Zuletzt erledigt ({done.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {done.map((t) => (
              <TaskRow key={t.id} id={t.id} title={t.title} done due={null} overdue={false} by={null} />
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
