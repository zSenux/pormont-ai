// Navigation: eine Liste für die Kopfleiste mit Bereichs-Menüs (PC/Windows-App), Handy-„Mehr“ und Schnellsuche.
// Gruppiert nach Arbeitsbereichen im Betrieb. Rechte: Menüpunkt nur, wenn der Bereich der Seite freigegeben ist (PATH_AREA).
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, Banknote, BookOpen, Calculator, Calendar, Camera, CheckSquare, ClipboardList, Clock, Database, Factory, FileText, FolderSearch, Gauge, Gavel, Handshake, HardHat, Home,
  IdCard, Coins, LayoutTemplate, Mail, Mic, Monitor, MonitorDown, Palmtree, PenTool, Receipt, Route, Settings, ShieldAlert, ShoppingCart, Sparkles, Target, TrendingUp, Truck, Wallet, Warehouse, Wrench, BellRing, Users, Workflow, Scale, FolderArchive,
} from "lucide-react";
import { PATH_AREA, type Area } from "@/lib/rights-shared";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; keywords?: string };
/** short = Beschriftung im Kopf am PC, icon = Symbol des Bereichs (schmale Fenster) */
export type NavGroup = { key: string; title: string; short?: string; icon?: LucideIcon; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "start",
    title: "Start",
    items: [
      { href: "/", label: "Übersicht", icon: Home, keywords: "dashboard start" },
      { href: "/ablauf", label: "Arbeitsablauf", icon: Workflow, keywords: "startbild ablauf kunde angebot auftragsbestätigung lieferschein rechnung bestellung" },
      { href: "/jarvis", label: "Jarvis", icon: Sparkles, keywords: "ki chat fragen" },
      { href: "/mail", label: "Mail", icon: Mail, keywords: "postfach e-mail" },
      { href: "/kalender", label: "Kalender", icon: Calendar, keywords: "termine" },
      { href: "/aufgaben", label: "Aufgaben", icon: CheckSquare, keywords: "todo erinnerung" },
    ],
  },
  {
    key: "vertrieb",
    title: "Vertrieb",
    short: "Vertrieb",
    icon: Target,
    items: [
      { href: "/akquise", label: "Akquise", icon: Target, keywords: "neukunden" },
      { href: "/ausschreibungen", label: "Ausschreibungen", icon: Gavel, keywords: "ted vergabe" },
      { href: "/buchhaltung/angebot-sprache", label: "Angebot sprechen", icon: Mic, keywords: "diktat" },
      { href: "/buchhaltung/vorlagen", label: "Angebotsvorlagen", icon: LayoutTemplate, keywords: "geländer treppe vordach tor 3d" },
      { href: "/auftraege", label: "Aufträge", icon: ClipboardList },
    ],
  },
  {
    key: "projekte",
    title: "Projekte",
    short: "Projekte",
    icon: HardHat,
    items: [
      { href: "/projekte", label: "Projekte", icon: HardHat, keywords: "baustelle phasen nachkalkulation" },
      { href: "/zeichnungen", label: "Zeichnungen", icon: PenTool, keywords: "cad konstruktion" },
      { href: "/bautagebuch", label: "Bautagebuch", icon: BookOpen },
      { href: "/maengel", label: "Mängel", icon: ShieldAlert, keywords: "gewährleistung reklamation" },
    ],
  },
  {
    key: "werkstatt",
    title: "Werkstatt & Montage",
    short: "Werkstatt",
    icon: Factory,
    items: [
      { href: "/fertigung", label: "Fertigung", icon: Factory, keywords: "kanban werkstatt" },
      { href: "/fertigung/kapazitaet", label: "Kapazität", icon: Gauge, keywords: "auslastung" },
      { href: "/montage", label: "Montage", icon: Wrench, keywords: "abnahme" },
      { href: "/montage/route", label: "Routenplanung", icon: Route, keywords: "fahrzeug navi" },
    ],
  },
  {
    key: "einkauf",
    title: "Einkauf & Lager",
    short: "Einkauf",
    icon: Truck,
    items: [
      { href: "/lieferanten", label: "Lieferanten", icon: Truck, keywords: "preisanfrage katalog" },
      { href: "/bestellungen", label: "Bestellungen", icon: ShoppingCart, keywords: "wareneingang" },
      { href: "/lager", label: "Lager", icon: Warehouse, keywords: "material bestand" },
      { href: "/lieferanten/stahl", label: "Stahl-Rechner", icon: Calculator, keywords: "profil gewicht ipe heb" },
      { href: "/nachunternehmer", label: "Nachunternehmer", icon: Handshake, keywords: "subunternehmer 48b" },
    ],
  },
  {
    key: "buchhaltung",
    title: "Buchhaltung",
    short: "Buchhaltung",
    icon: FileText,
    items: [
      { href: "/buchhaltung", label: "Angebote & Rechnungen", icon: FileText, keywords: "buchhaltung kunden artikel gutschrift" },
      { href: "/belege/foto", label: "Beleg fotografieren", icon: Camera, keywords: "kassenbon quittung" },
      { href: "/buchhaltung/ausgaben", label: "Ausgaben", icon: Wallet, keywords: "eingangsrechnung" },
      { href: "/buchhaltung/offene-posten", label: "Offene Posten", icon: Scale, keywords: "bezahlt offen forderungen verbindlichkeiten debitoren kreditoren rechnungseingang rechnungsausgang" },
      { href: "/buchhaltung/bank", label: "Bank", icon: Banknote, keywords: "kontoauszug abgleich" },
      { href: "/buchhaltung/ablage", label: "Ablage", icon: FolderArchive, keywords: "archiv monat kontoauszüge belege steuerberater zip" },
      { href: "/buchhaltung/mahnwesen", label: "Mahnwesen", icon: BellRing, keywords: "mahnung" },
      { href: "/buchhaltung/liquiditaet", label: "Liquidität", icon: TrendingUp, keywords: "kontostand planung" },
      { href: "/auswertung", label: "Auswertung", icon: BarChart3, keywords: "jahresauswertung umsatz" },
    ],
  },
  {
    key: "team",
    title: "Team",
    short: "Team",
    icon: Users,
    items: [
      { href: "/stunden", label: "Stunden", icon: Clock, keywords: "stempeluhr zeiten" },
      { href: "/abwesenheiten", label: "Urlaub & Krank", icon: Palmtree, keywords: "abwesenheit" },
      { href: "/spesen", label: "Spesen", icon: Receipt },
      { href: "/personal", label: "Personal", icon: IdCard, keywords: "personalakte mitarbeiter" },
    ],
  },
  {
    key: "system",
    title: "Werkzeuge",
    short: "Werkzeuge",
    icon: Settings,
    items: [
      { href: "/dokumente", label: "Dokumente", icon: FolderSearch, keywords: "suche dateien" },
      { href: "/pc", label: "Computer", icon: Monitor, keywords: "fernsteuerung" },
      { href: "/windows-app", label: "Windows-App", icon: MonitorDown, keywords: "download herunterladen installer programm desktop" },
      { href: "/datenuebernahme", label: "Datenübernahme", icon: Database, adminOnly: true, keywords: "import erp lexware" },
      { href: "/ki-kosten", label: "KI-Kosten", icon: Coins, adminOnly: true, keywords: "claude anthropic tokens verbrauch budget kosten jarvis" },
      { href: "/einstellungen", label: "Einstellungen", icon: Settings, keywords: "team verbindungen" },
    ],
  },
];

const areaOf = (href: string) => Object.entries(PATH_AREA).find(([p]) => href === p || href.startsWith(`${p}/`))?.[1];

/** Gruppen mit den Punkten, die dieser Nutzer sehen darf (leere Gruppen fallen weg) */
export function navFor(areas: readonly Area[], admin: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.adminOnly || admin) && (() => { const a = areaOf(i.href); return !a || areas.includes(a); })()),
  })).filter((g) => g.items.length > 0);
}

const ALL = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));

/** Aktiver Menüpunkt = längster passender Pfad (so ist /fertigung/kapazitaet nicht zugleich /fertigung) */
export function activeHref(path: string): string | null {
  let best: string | null = null;
  for (const h of ALL) {
    const hit = h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.length)) best = h;
  }
  // Unterseiten ohne eigenen Menüpunkt
  if (!best && path.startsWith("/belege")) return "/buchhaltung";
  return best;
}
