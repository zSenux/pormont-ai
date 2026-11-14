import { clsx } from "clsx";

/** Fortschrittsbalken (Projekte, Dashboard) */
export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={clsx("h-2 overflow-hidden rounded-full bg-mist", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full", pct >= 100 ? "bg-ok" : "bg-brand")} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
