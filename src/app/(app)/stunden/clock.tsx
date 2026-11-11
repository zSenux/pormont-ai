"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, Timer } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { clockIn, clockOut } from "@/app/actions/zeiten";

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  return <span className="tabular-nums">{Math.floor(min / 60)}:{String(min % 60).padStart(2, "0")} Std.</span>;
}

export function Clock({ running, projects }: { running: { since: string; sinceLabel: string; project: string | null } | null; projects: { id: string; name: string }[] }) {
  if (running) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-lg font-semibold text-ok"><Timer className="size-5" /> Eingestempelt seit {running.sinceLabel} · <Elapsed since={running.since} /></p>
        {running.project && <p className="text-sm text-steel">Projekt: {running.project}</p>}
        <StateForm action={clockOut} submit={<><LogOut className="size-4" /> Gehen</>} submitClass="btn-danger">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <label className="text-xs text-steel">Pause (Minuten)<input name="pause" inputMode="numeric" defaultValue="30" className="input mt-1 w-full" /></label>
            <label className="text-xs text-steel">Notiz (optional)<input name="note" placeholder="Was wurde gemacht?" className="input mt-1 w-full" /></label>
          </div>
          <p className="text-xs text-steel">Die gesetzliche Mindestpause (ab 6 Std. 30 min, ab 9 Std. 45 min) wird automatisch abgezogen.</p>
        </StateForm>
      </div>
    );
  }
  return (
    <StateForm action={clockIn} submit={<><LogIn className="size-4" /> Kommen</>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="projectId" className="input" aria-label="Projekt" defaultValue="">
          <option value="">Ohne Projekt (Werkstatt, Büro …)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input name="note" placeholder="Notiz (optional)" className="input" aria-label="Notiz" />
      </div>
    </StateForm>
  );
}
