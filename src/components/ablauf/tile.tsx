"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { clsx } from "clsx";
import { ABLAUF_ICONS, type AblaufIcon } from "./icons";

// Eine Kachel im Arbeitsablauf: Klick öffnet das Menü (wie beim gewohnten Startbild der Warenwirtschaft),
// darin „Übersicht öffnen“, „… neu“, Suche und die letzten offenen Vorgänge.

export type MenuEntry =
  | { type: "link"; label: string; href: string; hint?: string; strong?: boolean }
  | { type: "action"; label: string; action: () => Promise<void>; hint?: string; strong?: boolean }
  | { type: "search"; label: string; href: string; placeholder: string }
  | { type: "recent"; title: string; items: { label: string; sub?: string; href: string }[]; empty?: string };

export type TileStat = { text: string; tone?: "ok" | "warn" | "bad" | "muted" };

export function AblaufTile({ title, icon, badge, stats, menu, step }: { title: string; icon: AblaufIcon; badge?: number; stats: TileStat[]; menu: MenuEntry[]; step?: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const Icon = ABLAUF_ICONS[icon];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className={clsx("relative", open && "z-30")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={clsx(
          "group relative flex w-full items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-[0_8px_24px_-12px_rgba(9,47,80,.45)] transition md:flex-col md:items-center md:gap-2 md:px-3 md:py-5 md:text-center",
          open ? "border-glow ring-4 ring-sky-300/40" : "border-white/70 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_rgba(9,47,80,.55)]",
        )}
      >
        {step !== undefined && <span aria-hidden className="absolute top-2 left-2.5 hidden text-[10px] font-bold tracking-wider text-steel/70 md:block">{step}</span>}
        {badge !== undefined && badge > 0 && (
          <span aria-hidden className="absolute top-2 right-2 grid min-w-6 place-items-center rounded-full bg-brand px-1.5 py-0.5 text-[11px] leading-none font-bold text-white">{badge > 99 ? "99+" : badge}</span>
        )}
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand group-hover:text-white md:size-12">
          <Icon className="size-6" strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1 md:flex-none">
          <span className="flex items-center gap-1 font-semibold text-ink md:justify-center">
            {title}
            <ChevronDown className={clsx("size-3.5 text-steel transition", open && "rotate-180")} />
          </span>
          {stats.map((s, i) => (
            <span key={i} className={clsx("block truncate text-xs", s.tone === "bad" ? "font-semibold text-bad" : s.tone === "warn" ? "font-semibold text-warn" : s.tone === "ok" ? "text-ok" : "text-steel")}>{s.text}</span>
          ))}
        </span>
      </button>

      {open && (
        <div id={id} role="menu" className="absolute top-full right-0 left-0 z-40 mt-2 min-w-64 overflow-hidden rounded-2xl border border-line bg-white py-1.5 text-sm text-ink shadow-2xl md:left-1/2 md:w-72 md:-translate-x-1/2">
          <p className="px-4 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-steel uppercase">{title}</p>
          {menu.map((m, i) => {
            const cls = clsx("flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-brand-soft hover:text-brand", "strong" in m && m.strong && "font-semibold");
            if (m.type === "link")
              return (
                <Link key={i} href={m.href} role="menuitem" className={cls} onClick={() => setOpen(false)}>
                  <span className="flex-1">{m.label}</span>
                  {m.hint && <span className="text-xs text-steel">{m.hint}</span>}
                  <ChevronRight className="size-4 text-steel/60" />
                </Link>
              );
            if (m.type === "action")
              return (
                <form key={i} action={m.action}>
                  <button role="menuitem" className={cls}>
                    <span className="flex-1">{m.label}</span>
                    {m.hint && <span className="text-xs text-steel">{m.hint}</span>}
                    <ChevronRight className="size-4 text-steel/60" />
                  </button>
                </form>
              );
            if (m.type === "search")
              return (
                <form key={i} action={m.href} className="flex items-center gap-2 border-y border-line bg-mist/60 px-3 py-2">
                  <Search className="size-4 shrink-0 text-steel" />
                  <input name="q" placeholder={m.placeholder} aria-label={m.label} className="min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none" />
                  <button className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">Öffnen</button>
                </form>
              );
            return (
              <div key={i} className="border-t border-line pt-1.5">
                <p className="px-4 pb-1 text-[11px] font-semibold tracking-wider text-steel uppercase">{m.title}</p>
                {m.items.length === 0 && <p className="px-4 pb-2 text-xs text-steel">{m.empty ?? "Nichts offen."}</p>}
                {m.items.map((it) => (
                  <Link key={it.href} href={it.href} role="menuitem" className="block px-4 py-1.5 hover:bg-brand-soft" onClick={() => setOpen(false)}>
                    <span className="block truncate font-medium">{it.label}</span>
                    {it.sub && <span className="block truncate text-xs text-steel">{it.sub}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
