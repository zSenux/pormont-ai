"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Check, Download, Eye, EyeOff, Loader2, Monitor, Send, Square, X } from "lucide-react";

type Device = { id: string; name: string; remoteEnabled: boolean; online: boolean; viewing: boolean; lastSeenAt: string | null; status: Record<string, unknown> | null };
type Line = { at: string; text: string };
type Job = { id: string; deviceId: string; chatId: string; prompt: string; origin: string; status: "QUEUED" | "RUNNING" | "CONFIRM" | "DONE" | "ERROR" | "CANCELED"; lines: Line[]; reply: string | null; confirm: { text: string; detail: string } | null; createdAt: string; finishedAt: string | null };
type State = { devices: Device[]; jobs: Job[] };

const STATUS: Record<Job["status"], { label: string; cls: string }> = {
  QUEUED: { label: "Wartet auf den PC", cls: "bg-mist text-steel" },
  RUNNING: { label: "Läuft", cls: "bg-brand-soft text-brand" },
  CONFIRM: { label: "Wartet auf dich", cls: "bg-amber-100 text-amber-800" },
  DONE: { label: "Fertig", cls: "bg-emerald-100 text-emerald-800" },
  ERROR: { label: "Problem", cls: "bg-red-100 text-red-800" },
  CANCELED: { label: "Gestoppt", cls: "bg-mist text-steel" },
};
const OPEN = ["QUEUED", "RUNNING", "CONFIRM"];
const time = (s: string) => new Date(s).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const when = (s: string | null) => (s ? new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }) : "nie");

const EXAMPLES = [
  "Such die Zeichnung vom Geländer Müller und mach daraus ein Angebot",
  "Öffne Excel und zeig mir die Materialliste von diesem Monat",
  "Exportiere die offene Zeichnung im CAD als PDF und leg sie bei Jarvis ab",
];

async function call(url: string, body?: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Fehler.");
  return d;
}

export function PcView({ initial, focusJob, downloadUrl }: { initial: State; focusJob: string | null; downloadUrl: string | null }) {
  const [state, setState] = useState<State>(initial);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setState(await call("/api/pc/jobs", undefined, "GET"));
    } catch {
      /* nächstes Mal */
    }
  }, []);

  const active = state.jobs.find((j) => j.id === focusJob && OPEN.includes(j.status)) ?? state.jobs.find((j) => OPEN.includes(j.status)) ?? (focusJob ? state.jobs.find((j) => j.id === focusJob) : undefined);
  const device = state.devices.find((d) => d.id === active?.deviceId) ?? state.devices[0];
  const viewing = Boolean(device?.viewing);

  // Fortschritt: schneller abfragen, solange etwas läuft oder das Live-Bild an ist
  useEffect(() => {
    const ms = active && OPEN.includes(active.status) ? 2500 : viewing ? 2000 : 8000;
    const t = setInterval(() => {
      refresh();
      setTick((n) => n + 1);
    }, ms);
    return () => clearInterval(t);
  }, [refresh, active, viewing]);

  // Letztes Bildschirmfoto des laufenden Auftrags
  useEffect(() => {
    if (!active || viewing) return;
    let stop = false;
    fetch(`/api/pc/jobs/${active.id}?bild=1`)
      .then((r) => r.json())
      .then((j) => !stop && setShot(j?.screenshot ? `data:image/jpeg;base64,${j.screenshot}` : null))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [active, viewing, tick]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler.");
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      const r = await call("/api/pc/jobs", { prompt, deviceId: device?.id });
      setPrompt("");
      const url = new URL(window.location.href);
      url.searchParams.set("auftrag", r.id);
      window.history.replaceState(null, "", url);
    });

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Computer</h1>
        <p className="mt-1 text-sm text-steel">Jarvis bedient den Büro-PC wie ein Mensch: Programme (auch CAD), Dateien, Zeichnungen, Angebote. Am PC selbst einfach im Chat sagen „Am PC: …“.</p>
      </div>

      {state.devices.length === 0 ? (
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Monitor className="size-5 text-brand" /> Noch kein PC verbunden</h2>
          <ol className="list-decimal space-y-1 pl-5 text-steel">
            <li>Jarvis-App für Windows installieren und Server-Adresse eintragen.</li>
            <li>In der App mit deinem Jarvis-Konto anmelden – der PC erscheint dann hier.</li>
            <li>Für Aufträge vom Handy: am PC unten rechts auf das Jarvis-Symbol → „Fernsteuerung vom Handy erlauben“.</li>
          </ol>
          {downloadUrl && <a href={downloadUrl} className="btn-secondary w-fit"><Download className="size-4" /> Windows-App herunterladen</a>}
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {state.devices.map((d) => (
            <div key={d.id} className="card flex items-center gap-3 p-4">
              <Monitor className="size-8 flex-none text-brand" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-steel">
                  <span className={clsx("mr-1 inline-block size-2 rounded-full", d.online ? "bg-emerald-500" : "bg-steel/40")} />
                  {d.online ? "Erreichbar" : `Aus · zuletzt ${when(d.lastSeenAt)}`} · Fernsteuerung {d.remoteEnabled ? "an" : "aus"}
                </div>
              </div>
              {d.online && d.remoteEnabled && (
                <button className="btn-secondary" disabled={busy} onClick={() => run(() => call(`/api/pc/devices/${d.id}`, { view: !d.viewing }))}>
                  {d.viewing ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {d.viewing ? "Bild aus" : "Live"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {device && (
        <section className="card space-y-3 p-4">
          <label htmlFor="pc-auftrag" className="text-sm font-semibold">Auftrag an {device.name}</label>
          <textarea id="pc-auftrag" className="input min-h-24 w-full" placeholder="Was soll Jarvis am PC erledigen?" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="chip border-line bg-mist text-left text-steel hover:text-ink" onClick={() => setPrompt(e)}>{e}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy || prompt.trim().length < 2 || !device.online} onClick={send}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} An den PC schicken
            </button>
            {!device.online && <span className="text-sm text-steel">Der PC ist gerade aus oder die App läuft nicht.</span>}
            {device.online && !device.remoteEnabled && <span className="text-sm text-steel">Fernsteuerung am PC ausgeschaltet.</span>}
          </div>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </section>
      )}

      {(viewing || active) && device && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="card self-start overflow-hidden p-0">
            {viewing ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/pc/view?pc=${device.id}&t=${tick}`} alt={`Live-Bild von ${device.name}`} className="block w-full bg-brand-2" />
            ) : shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot} alt="Letztes Bildschirmfoto" className="block w-full bg-brand-2" />
            ) : (
              <div className="grid aspect-video place-items-center bg-brand-2 text-sm text-white/70">Noch kein Bild</div>
            )}
          </div>
          {active && <JobCard job={active} busy={busy} run={run} />}
        </section>
      )}

      {state.jobs.length > 0 && (
        <section className="card divide-y divide-line">
          <h2 className="px-4 py-3 text-sm font-semibold">Letzte Aufträge</h2>
          {state.jobs.map((j) => (
            <Link key={j.id} href={`/pc?auftrag=${j.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-mist">
              <span className={clsx("chip flex-none border-0", STATUS[j.status].cls)}>{STATUS[j.status].label}</span>
              <span className="min-w-0 flex-1 truncate">{j.prompt}</span>
              <span className="flex-none text-steel">{time(j.createdAt)}</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}

function JobCard({ job, busy, run }: { job: Job; busy: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const open = OPEN.includes(job.status);
  return (
    <div className="card flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-start gap-2">
        <span className={clsx("chip flex-none border-0", STATUS[job.status].cls)}>{STATUS[job.status].label}</span>
        <p className="font-medium">{job.prompt}</p>
      </div>

      {job.status === "CONFIRM" && job.confirm && (
        <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold">{job.confirm.text}</p>
          {job.confirm.detail && <p className="whitespace-pre-line text-steel [overflow-wrap:anywhere]">{job.confirm.detail}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => run(() => call(`/api/pc/jobs/${job.id}/decide`, { yes: true }))}><Check className="size-4" /> Erlauben</button>
            <button className="btn-secondary" disabled={busy} onClick={() => run(() => call(`/api/pc/jobs/${job.id}/decide`, { yes: false }))}><X className="size-4" /> Ablehnen</button>
          </div>
        </div>
      )}

      <ol className="max-h-72 space-y-1 overflow-y-auto text-steel">
        {job.lines.slice(-30).map((l, i) => (
          <li key={i} className="flex gap-2"><span className="flex-none tabular-nums">{time(l.at)}</span><span className="min-w-0 [overflow-wrap:anywhere]">{l.text}</span></li>
        ))}
        {job.lines.length === 0 && <li>Wartet, bis der PC den Auftrag abholt …</li>}
      </ol>

      {job.reply && <p className={clsx("rounded-2xl p-3", job.status === "ERROR" ? "bg-red-50 text-red-800" : "bg-mist text-ink")}>{job.reply}</p>}

      <div className="mt-auto flex flex-wrap gap-2">
        {open && <button className="btn-danger" disabled={busy} onClick={() => run(() => call(`/api/pc/jobs/${job.id}/cancel`, {}))}><Square className="size-4" /> Stopp</button>}
        <Link href={`/jarvis?chat=${job.chatId}`} className="btn-secondary">Verlauf & Freigaben</Link>
      </div>
    </div>
  );
}
