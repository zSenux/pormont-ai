"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CheckSquare, ChevronDown, Home, LogOut, Mail, Menu, Search, Sparkles, X } from "lucide-react";
import { clsx } from "clsx";
import type { Area } from "@/lib/rights-shared";
import { activeHref, navFor, type NavGroup } from "@/lib/nav-shared";

const STORE = "pm-nav-zu";

/** Treffer der Schnellsuche (Bezeichnung, Gruppe oder Stichwort) */
function search(groups: NavGroup[], q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return groups.flatMap((g) => g.items.filter((i) => `${i.label} ${g.title} ${i.keywords ?? ""}`.toLowerCase().includes(s)).map((i) => ({ ...i, group: g.title })));
}

/** PC + Windows-App: Seitenleiste mit Bereichen (einklappbar), Schnellsuche mit Strg+K */
export function SideNav({ name, funktion, areas, admin, logout }: { name: string; funktion: string | null; areas: readonly Area[]; admin: boolean; logout: () => Promise<void> }) {
  const path = usePathname();
  const router = useRouter();
  const groups = useMemo(() => navFor(areas, admin), [areas, admin]);
  const current = activeHref(path);
  const [closed, setClosed] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hits = search(groups, q);
  const list = useRef<HTMLElement>(null);

  // Aktiven Punkt sichtbar halten (lange Leiste im kleinen Fenster der Windows-App)
  useEffect(() => {
    list.current?.querySelector("[aria-current=page]")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (key: string) => {
    const next = closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key];
    setClosed(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };

  const link = (i: NavGroup["items"][number]) => (
    <Link
      key={i.href}
      href={i.href}
      onClick={() => setQ("")}
      aria-current={current === i.href ? "page" : undefined}
      className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition", current === i.href ? "bg-brand text-white" : "text-steel hover:bg-mist hover:text-ink")}
    >
      <i.icon className="size-4 shrink-0" />
      <span className="truncate">{i.label}</span>
    </Link>
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-white print:hidden md:flex" aria-label="Hauptnavigation">
      <Link href="/" className="flex h-16 shrink-0 items-center gap-2 px-4" aria-label="Startseite">
        <img src="/logo.svg" alt="ProMont GmbH" className="h-10 w-auto" />
        <span className="chip border-brand/20 bg-brand-soft text-brand">Jarvis</span>
      </Link>
      <div className="px-3 pb-2">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-mist/60 px-2.5 py-1.5 text-sm focus-within:border-brand">
          <Search className="size-4 shrink-0 text-steel" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                router.push(hits[0].href);
                setQ("");
                input.current?.blur();
              }
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Bereich suchen"
            aria-label="Bereich suchen"
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-steel"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Suche leeren"><X className="size-3.5 text-steel" /></button>
          ) : (
            <kbd className="hidden shrink-0 rounded border border-line bg-white px-1 text-[10px] text-steel lg:inline">Strg K</kbd>
          )}
        </label>
      </div>

      <nav ref={list} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
        {q ? (
          hits.length ? (
            <div className="space-y-0.5">{hits.map(link)}</div>
          ) : (
            <p className="px-2.5 py-2 text-sm text-steel">Nichts gefunden. Frag Jarvis!</p>
          )
        ) : (
          groups.map((g) => {
            // Die Gruppe der aktuellen Seite ist immer offen
            const open = g.key === "start" || !closed.includes(g.key) || g.items.some((i) => i.href === current);
            return (
              <div key={g.key} className="pt-1">
                {g.key !== "start" && (
                  <button type="button" onClick={() => toggle(g.key)} aria-expanded={open} className="flex w-full items-center justify-between px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-steel uppercase hover:text-ink">
                    {g.title}
                    <ChevronDown className={clsx("size-3.5 transition", !open && "-rotate-90")} />
                  </button>
                )}
                {open && <div className="space-y-0.5">{g.items.map(link)}</div>}
              </div>
            );
          })
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          {funktion && <span className="block truncate text-xs text-steel">{funktion}</span>}
        </span>
        <form action={logout}>
          <button className="grid size-8 place-items-center rounded-lg text-steel hover:bg-mist hover:text-ink" title="Abmelden" aria-label="Abmelden">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 print:hidden pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" aria-label="Startseite">
          <img src="/logo.svg" alt="ProMont GmbH" className="h-10 w-auto" />
        </Link>
        <span className="chip border-brand/20 bg-brand-soft text-brand">Jarvis</span>
      </div>
    </header>
  );
}

// Handy: 5 Tabs, alles andere liegt gruppiert unter „Mehr“ (/einstellungen)
export function MobileNav({ areas }: { areas: readonly Area[] }) {
  const path = usePathname();
  const mail = areas.includes("mail");
  const tabs = [
    { href: "/", label: "Übersicht", icon: Home },
    mail ? { href: "/mail", label: "Mail", icon: Mail } : { href: "/aufgaben", label: "Aufgaben", icon: CheckSquare },
    { href: "/jarvis", label: "Jarvis", icon: Sparkles, center: true },
    { href: "/kalender", label: "Kalender", icon: Calendar },
  ];
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const more = !tabs.some((t) => on(t.href));
  return (
    <nav className="safe-bottom fixed print:hidden inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur md:hidden" aria-label="Hauptnavigation">
      <div className="grid h-16 grid-cols-5">
        {tabs.map((i) =>
          i.center ? (
            <Link key={i.href} href={i.href} className="flex flex-col items-center justify-center" aria-label="Jarvis">
              <span className={clsx("-mt-6 grid size-14 place-items-center rounded-full border-4 border-white shadow-lg", on(i.href) ? "bg-brand-2" : "bg-brand")}>
                <i.icon className="size-6 text-white" />
              </span>
              <span className="mt-0.5 text-[10px] font-semibold text-brand">Jarvis</span>
            </Link>
          ) : (
            <Link key={i.href} href={i.href} className={clsx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on(i.href) ? "text-brand" : "text-steel")}>
              <i.icon className="size-5" />
              {i.label}
            </Link>
          ),
        )}
        <Link href="/einstellungen" className={clsx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", more ? "text-brand" : "text-steel")}>
          <Menu className="size-5" />
          Mehr
        </Link>
      </div>
    </nav>
  );
}
