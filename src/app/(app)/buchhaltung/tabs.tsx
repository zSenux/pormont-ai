"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { clsx } from "clsx";

export function BookTabs({ admin }: { admin: boolean }) {
  const path = usePathname();
  const art = useSearchParams().get("art");
  const tabs = [
    { href: "/buchhaltung", label: "Übersicht", on: path === "/buchhaltung" },
    { href: "/buchhaltung/belege?art=angebote", label: "Angebote", on: path.startsWith("/buchhaltung/belege") && art === "angebote" },
    { href: "/buchhaltung/belege?art=rechnungen", label: "Rechnungen", on: path.startsWith("/buchhaltung/belege") && art !== "angebote" && art !== "gutschriften" },
    { href: "/buchhaltung/belege?art=gutschriften", label: "Gutschriften", on: path.startsWith("/buchhaltung/belege") && art === "gutschriften" },
    { href: "/buchhaltung/kunden", label: "Kunden", on: path.startsWith("/buchhaltung/kunden") },
    { href: "/buchhaltung/artikel", label: "Artikel", on: path.startsWith("/buchhaltung/artikel") },
    ...(admin ? [{ href: "/buchhaltung/einstellungen", label: "Einstellungen", on: path.startsWith("/buchhaltung/einstellungen") }] : []),
  ];
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 print:hidden" aria-label="Buchhaltung">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={clsx("shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition", t.on ? "bg-brand text-white" : "bg-white text-steel hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
