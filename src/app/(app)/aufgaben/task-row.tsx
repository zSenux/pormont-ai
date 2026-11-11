"use client";

import { useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { deleteTask, toggleTask } from "@/app/actions";

export function TaskRow({ id, title, done, due, overdue, by }: { id: string; title: string; done: boolean; due: string | null; overdue: boolean; by: string | null }) {
  const [pending, start] = useTransition();
  return (
    <li className={clsx("flex items-center gap-3 px-4 py-3 text-sm", pending && "opacity-50")}>
      <button type="button" onClick={() => start(() => toggleTask(id))} className={clsx("grid size-6 shrink-0 place-items-center rounded-full border-2", done ? "border-ok bg-ok text-white" : "border-line hover:border-brand")} aria-label={done ? "Wieder öffnen" : "Erledigt"}>
        {done && <Check className="size-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={clsx("truncate", done && "text-steel line-through")}>{title}</p>
        {(due || by) && (
          <p className={clsx("text-xs", overdue ? "text-bad" : "text-steel")}>
            {due}
            {due && by ? " · " : ""}
            {by ? `von ${by}` : ""}
          </p>
        )}
      </div>
      <button type="button" onClick={() => start(() => deleteTask(id))} className="rounded-full p-1.5 text-steel hover:bg-red-50 hover:text-bad" aria-label="Löschen">
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
