"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY as KEY } from "@/lib/theme-script";

// Darstellung je Gerät (localStorage "pm-theme"):
// auto   = Handy dunkel, PC hell (Standard)
// system = wie das Gerät (hell/dunkel nach Systemeinstellung)
// light / dark = immer hell / immer dunkel
export type ThemeMode = "auto" | "system" | "light" | "dark";

declare global {
  interface Window {
    __pmTheme?: (m: ThemeMode) => void;
  }
}

function current(): ThemeMode {
  if (typeof document === "undefined") return "auto";
  const m = document.documentElement.dataset.theme;
  return m === "system" || m === "light" || m === "dark" ? m : "auto";
}

function setMode(m: ThemeMode) {
  if (window.__pmTheme) window.__pmTheme(m);
  else {
    try {
      localStorage.setItem(KEY, m);
    } catch {}
    document.documentElement.classList.toggle("dark", m === "dark");
    document.documentElement.dataset.theme = m;
  }
}

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const d = document.documentElement;
    const read = () => setDark(d.classList.contains("dark"));
    read();
    const o = new MutationObserver(read);
    o.observe(d, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

const OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "auto", label: "Automatisch", hint: "Handy dunkel, PC hell" },
  { value: "system", label: "Wie Gerät", hint: "folgt der Systemeinstellung" },
  { value: "light", label: "Hell", hint: "immer hell" },
  { value: "dark", label: "Dunkel", hint: "immer dunkel" },
];

/** Auswahl in den Einstellungen (gilt nur für dieses Gerät). */
export function ThemeSetting() {
  const [mode, setState] = useState<ThemeMode>("auto");
  useEffect(() => setState(current()), []);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Darstellung">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          onClick={() => {
            setMode(o.value);
            setState(o.value);
          }}
          className={clsx(
            "rounded-xl border px-3 py-2 text-left text-sm transition",
            mode === o.value ? "border-brand bg-brand-soft text-brand" : "border-line bg-white text-ink hover:border-brand",
          )}
        >
          <span className="block font-semibold">{o.label}</span>
          <span className="block text-xs text-steel">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** Kleiner Umschalter Sonne/Mond (Handy-Kopfleiste). */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useDark();
  return (
    <button
      type="button"
      onClick={() => setMode(dark ? "light" : "dark")}
      aria-label={dark ? "Helles Design" : "Dunkles Design"}
      title={dark ? "Helles Design" : "Dunkles Design"}
      className={clsx("grid size-9 place-items-center rounded-full border border-line text-steel transition hover:text-brand", className)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
