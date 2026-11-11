"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, CheckSquare, Clock, FileText, FolderSearch, HardHat, Home, Mail, Menu, Monitor, Receipt, Settings, Sparkles, Target, Truck } from "lucide-react";
import { clsx } from "clsx";

const DESKTOP = [
  { href: "/", label: "Übersicht", icon: Home },
  { href: "/jarvis", label: "Jarvis", icon: Sparkles },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/kalender", label: "Kalender", icon: Calendar },
  { href: "/projekte", label: "Projekte", icon: HardHat },
  { href: "/stunden", label: "Stunden", icon: Clock },
  { href: "/spesen", label: "Spesen", icon: Receipt },
  { href: "/akquise", label: "Akquise", icon: Target },
  { href: "/lieferanten", label: "Lieferanten", icon: Truck },
  { href: "/belege", label: "Belege", icon: FileText },
  { href: "/dokumente", label: "Dokumente", icon: FolderSearch },
  { href: "/aufgaben", label: "Aufgaben", icon: CheckSquare },
  { href: "/pc", label: "Computer", icon: Monitor },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

// Handy: 5 Tabs, der Rest liegt unter „Mehr“ (Kacheln auf der Einstellungsseite)
const MOBILE = [
  { href: "/", label: "Übersicht", icon: Home },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/jarvis", label: "Jarvis", icon: Sparkles, center: true },
  { href: "/kalender", label: "Kalender", icon: Calendar },
  { href: "/einstellungen", label: "Mehr", icon: Menu, also: ["/projekte", "/stunden", "/spesen", "/akquise", "/lieferanten", "/belege", "/dokumente", "/aufgaben", "/pc"] },
];

const active = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function TopNav({ name }: { name: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 hidden border-b print:hidden border-line bg-white/90 backdrop-blur md:block">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Startseite">
          <img src="/logo.svg" alt="ProMont GmbH" className="h-11 w-auto" />
          <span className="chip border-brand/20 bg-brand-soft text-brand">Jarvis</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          {DESKTOP.map((i) => (
            <Link key={i.href} href={i.href} title={i.label} className={clsx("flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition", active(path, i.href) ? "bg-brand text-white" : "text-steel hover:bg-mist hover:text-ink")}>
              <i.icon className="size-4" />
              {/* 14 Bereiche: Beschriftung nur am aktiven Punkt (sonst Tooltip), damit die Leiste nicht überläuft */}
              <span className={i.href !== "/einstellungen" && active(path, i.href) ? "hidden lg:inline" : "sr-only"}>{i.label}</span>
            </Link>
          ))}
        </nav>
        <span className="hidden text-sm text-steel 2xl:inline">{name}</span>
      </div>
    </header>
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

export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed print:hidden inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur md:hidden" aria-label="Hauptnavigation">
      <div className="grid h-16 grid-cols-5">
        {MOBILE.map((i) =>
          i.center ? (
            <Link key={i.href} href={i.href} className="flex flex-col items-center justify-center" aria-label="Jarvis">
              <span className={clsx("-mt-6 grid size-14 place-items-center rounded-full border-4 border-white shadow-lg", active(path, i.href) ? "bg-brand-2" : "bg-brand")}>
                <i.icon className="size-6 text-white" />
              </span>
              <span className="mt-0.5 text-[10px] font-semibold text-brand">Jarvis</span>
            </Link>
          ) : (
            <Link key={i.href} href={i.href} className={clsx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active(path, i.href) || i.also?.some((h) => path.startsWith(h)) ? "text-brand" : "text-steel")}>
              <i.icon className="size-5" />
              {i.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
