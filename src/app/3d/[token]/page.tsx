import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { PRODUCTS, type Product } from "@/lib/vorlagen/model";
import { PublicView } from "./view";

// Öffentliche 3D-Ansicht für Kunden (Link im Angebot): nur Modell und Beschreibung, keine Preise.
// Im matcher von proxy.ts ausgenommen; der Token (144 Bit) ist der Zugang.

export const dynamic = "force-dynamic";
export const metadata = { title: "3D-Ansicht", robots: { index: false, follow: false } };

export default async function Public3dPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) notFound();
  const cfg = await db.productConfig.findUnique({ where: { token }, select: { product: true, params: true, title: true, doc: { select: { number: true, kind: true } } } });
  if (!cfg || !(PRODUCTS as readonly string[]).includes(cfg.product)) notFound();
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <img src="/logo.svg" alt={COMPANY.name} className="h-9 w-auto" />
        <span className="text-right text-xs text-steel">{cfg.doc?.number ? `Zu Angebot ${cfg.doc.number}` : "Angebotsentwurf"}</span>
      </header>
      <PublicView product={cfg.product as Product} params={cfg.params} title={cfg.title} />
      <footer className="mt-auto text-center text-xs text-steel">
        {COMPANY.name} · {COMPANY.street} · {COMPANY.zip} {COMPANY.city} · {COMPANY.phone} · {COMPANY.email}
      </footer>
    </main>
  );
}
