import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { CustomerForm } from "../form";

export const metadata = { title: "Neuer Kunde" };

export default async function NeuerKunde({ searchParams }: { searchParams: Promise<{ back?: string }> }) {
  await requireUser();
  const back = (await searchParams).back;
  const safeBack = back && /^\/buchhaltung\/beleg\/[a-z0-9]+$/.test(back) ? back : undefined;
  return (
    <main className="mx-auto max-w-2xl space-y-4">
      <Link href={safeBack ?? "/buchhaltung/kunden"} className="flex items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Zurück</Link>
      <h1 className="page-title">Neuer Kunde</h1>
      <section className="card p-4"><CustomerForm back={safeBack} /></section>
    </main>
  );
}
