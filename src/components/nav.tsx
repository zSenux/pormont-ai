"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, CheckSquare, ChevronDown, Home, LogOut, Mail, Menu, Search, Sparkles, X } from "lucide-react";
import { clsx } from "clsx";
import type { Area } from "@/lib/rights-shared";
import { activeHref, navFor, type NavGroup, type NavItem } from "@/lib/nav-shared";

/** Treffer der Schnellsuche (Bezeichnung, Gruppe oder Stichwort) */
function search(groups: NavGroup[], q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return groups.flatMap((g) => g.items.filter((i) => `${i.label} ${g.title} ${i.keywords ?? ""}`.toLowerCase().includes(s)).map((i) => ({ ...i, group: g.title })));
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/**
 * PC + Windows-App: Kopfleiste. Links die Alltags-Seiten (Übersicht, Jarvis, Mail, Kalender, Aufgaben),
 * dann je Bereich ein Menü (Vertrieb, Projekte, Werkstatt, Einkauf, Buchhaltung, Team), rechts Suche (Strg+K) und Konto-Menü.
 */
export function TopNav({ name, funktion, areas, admin, logout }: { name: string; funktion: string | null; areas: readonly Area[]; admin: boolean; logout: () => Promise<void> }) {
  const path = usePathname();
  const groups = useMemo(() => navFor(areas, admin), [areas, admin]);
  const current = activeHref(path);
  const [open, setOpen] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const bar = useRef<HTMLElement>(null);

  const start = groups.find((g) => g.key === "start")?.items ?? [];
  const menus = groups.filter((g) => g.key !== "start" && g.key !== "system");
  const tools = groups.find((g) => g.key === "system")?.items ?? [];

  // Menü schließen: Seitenwechsel, Klick daneben, Esc; Strg+K öffnet die Suche
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(null);
        setPalette(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const pill = (on: boolean) => clsx("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition", on ? "bg-brand text-white" : "text-steel hover:bg-mist hover:text-ink");

  return (
    <header ref={bar} className="sticky top-0 z-30 hidden border-b border-line bg-white/95 backdrop-blur print:hidden md:block">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-1 px-4 lg:px-6">
        <Link href="/" className="mr-2 flex shrink-0 items-center gap-2" aria-label="Startseite">
          <img src="/logo.svg" alt="ProMont GmbH" className="h-10 w-auto" />
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-0.5" aria-label="Hauptnavigation">
          {start.map((i) => (
            <Link key={i.href} href={i.href} title={i.label} aria-current={current === i.href ? "page" : undefined} className={pill(current === i.href)}>
              <i.icon className="size-4" />
              {/* Beschriftung erst bei breitem Fenster, sonst Tooltip */}
              <span className="hidden 2xl:inline">{i.label}</span>
            </Link>
          ))}
          <span className="mx-1.5 h-6 w-px shrink-0 bg-line" aria-hidden />
          {menus.map((g) => {
            const on = g.items.some((i) => i.href === current);
            const Icon = g.icon;
            return (
              <div key={g.key} className="relative">
                <button type="button" onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key} aria-haspopup="menu" title={g.title} className={pill(on)}>
                  {Icon && <Icon className="size-4 lg:hidden 2xl:inline" />}
                  <span className="hidden lg:inline">{g.short ?? g.title}</span>
                  <ChevronDown className={clsx("size-3.5 transition", open === g.key && "rotate-180")} />
                </button>
                {open === g.key && <Panel title={g.title} items={g.items} current={current} />}
              </div>
            );
          })}
        </nav>

        <button type="button" onClick={() => setPalette(true)} className="flex shrink-0 items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-steel hover:border-brand hover:text-ink" title="Seite suchen (Strg+K)">
          <Search className="size-4" />
          <span className="hidden 2xl:inline">Suchen</span>
          <kbd className="hidden rounded border border-line bg-mist px-1 text-[10px] 2xl:inline">Strg K</kbd>
        </button>

        <div className="relative ml-1">
          <button type="button" onClick={() => setOpen(open === "konto" ? null : "konto")} aria-expanded={open === "konto"} aria-haspopup="menu" title={name} aria-label={`Konto: ${name}`} className={clsx("flex items-center gap-1 rounded-full p-1 transition hover:bg-mist", tools.some((i) => i.href === current) && "ring-2 ring-brand")}>
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initials(name)}</span>
            <ChevronDown className="size-3.5 text-steel" />
          </button>
          {open === "konto" && (
            <div className="absolute top-full right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl" role="menu">
              <div className="border-b border-line px-3 pt-1 pb-2">
                <p className="truncate text-sm font-semibold">{name}</p>
                {funktion && <p className="truncate text-xs text-steel">{funktion}</p>}
              </div>
              <div className="py-1">
                {tools.map((i) => (
                  <Link key={i.href} href={i.href} role="menuitem" className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", current === i.href ? "bg-brand-soft font-semibold text-brand" : "hover:bg-mist")}>
                    <i.icon className="size-4 text-brand" /> {i.label}
                  </Link>
                ))}
              </div>
              <form action={logout} className="border-t border-line pt-1">
                <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-steel hover:bg-mist hover:text-ink" role="menuitem">
                  <LogOut className="size-4" /> Abmelden
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
      {/* Portal: die Kopfleiste hat backdrop-blur, „fixed“ würde sonst nur innerhalb der Leiste gelten */}
      {palette && createPortal(<Palette groups={groups} onClose={() => setPalette(false)} />, document.body)}
    </header>
  );
}

/** Ausklapp-Menü eines Bereichs */
function Panel({ title, items, current }: { title: string; items: NavItem[]; current: string | null }) {
  return (
    <div className="absolute top-full left-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl" role="menu" aria-label={title}>
      <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-steel uppercase">{title}</p>
      {items.map((i) => (
        <Link key={i.href} href={i.href} role="menuitem" aria-current={current === i.href ? "page" : undefined} className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", current === i.href ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-mist")}>
          <i.icon className="size-4 shrink-0 text-brand" /> {i.label}
        </Link>
      ))}
    </div>
  );
}

/** Schnellsuche (Strg+K): Seite tippen, Enter springt hin */
function Palette({ groups, onClose }: { groups: NavGroup[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const hits = q ? search(groups, q) : groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Seite suchen">
        <label className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="size-5 text-steel" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && hits[sel]) go(hits[sel].href);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Wohin? z. B. Mahnwesen, Lager, Urlaub …"
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-steel"
          />
          <button type="button" onClick={onClose} aria-label="Schließen"><X className="size-4 text-steel" /></button>
        </label>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-steel">Nichts gefunden. Frag Jarvis!</li>}
          {hits.map((i, k) => (
            <li key={i.href}>
              <button type="button" onMouseEnter={() => setSel(k)} onClick={() => go(i.href)} className={clsx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", k === sel ? "bg-brand-soft text-brand" : "text-ink")}>
                <i.icon className="size-4 shrink-0 text-brand" />
                <span className="flex-1">{i.label}</span>
                <span className="text-xs text-steel">{i.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
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
