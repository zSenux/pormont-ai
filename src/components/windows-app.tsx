"use client";

import { useEffect, useState } from "react";
import { Download, MonitorDown, X } from "lucide-react";

// Hinweis/Knopf zum Herunterladen der Windows-App. Der Link führt über /api/windows-app
// immer auf den Installer der neuesten Version. In der Windows-App selbst ausgeblendet.

type Env = "loading" | "desktop-app" | "windows" | "other";
const HIDE_KEY = "jarvis-windows-hinweis-aus";

function detect(): Env {
  const ua = navigator.userAgent;
  if (/JarvisPromont/i.test(ua) || "jarvisDesktop" in window) return "desktop-app";
  if (/windows/i.test(ua) && !/windows phone/i.test(ua)) return "windows";
  return "other";
}

function useEnv() {
  const [env, setEnv] = useState<Env>("loading");
  useEffect(() => setEnv(detect()), []);
  return env;
}

const sizeMb = (b?: number | null) => (b ? `${Math.round(b / 1_000_000)} MB` : null);

/** Gut sichtbarer Hinweis auf der Übersicht – nur in einem Windows-Browser, schließbar. */
export function WindowsAppBanner({ version, size }: { version: string | null; size: number | null }) {
  const env = useEnv();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (env !== "windows" || hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {}
    setHidden(true);
  };
  return (
    <section className="card relative flex flex-col gap-4 border-brand/30 bg-brand-soft p-5 md:flex-row md:items-center">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white"><MonitorDown className="size-6" /></span>
      <div className="min-w-0 flex-1 pr-6 md:pr-0">
        <h2 className="font-semibold text-brand-2">Jarvis als Windows-App</h2>
        <p className="text-sm text-steel">
          Eigenes Fenster, Start mit Windows und <kbd className="chip border-line bg-white">Strg + Leertaste</kbd> öffnet Jarvis von überall. Aktualisiert sich selbst.
        </p>
      </div>
      <a href="/api/windows-app" className="btn-primary w-fit shrink-0">
        <Download className="size-4" /> Herunterladen{version ? ` (v${version}${sizeMb(size) ? `, ${sizeMb(size)}` : ""})` : ""}
      </a>
      <button onClick={close} className="absolute top-3 right-3 rounded-full p-1 text-steel hover:bg-white" aria-label="Hinweis ausblenden" title="Ausblenden (bleibt in den Einstellungen)">
        <X className="size-4" />
      </button>
    </section>
  );
}

/** Knopf in den Einstellungen – überall sichtbar außer in der Windows-App. */
export function WindowsAppDownload({ version, size }: { version: string | null; size: number | null }) {
  const env = useEnv();
  if (env === "loading") return null;
  if (env === "desktop-app") return <p className="text-sm text-ok">Du nutzt bereits die Windows-App – sie aktualisiert sich automatisch.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href="/api/windows-app" className={env === "windows" ? "btn-primary w-fit" : "btn-secondary w-fit"}>
        <Download className="size-4" /> Windows-App herunterladen
      </a>
      {version && <span className="text-xs text-steel">Version {version}{sizeMb(size) ? ` · ${sizeMb(size)}` : ""}</span>}
      {env === "other" && <span className="text-xs text-steel">Den Installer auf dem Windows-PC öffnen.</span>}
    </div>
  );
}
