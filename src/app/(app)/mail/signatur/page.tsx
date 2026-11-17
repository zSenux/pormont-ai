import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireArea } from "@/lib/rights";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { mailAddress, mailConfig } from "@/lib/mail/config";
import { signatureConfig } from "@/lib/mail/signature";
import { personSchema } from "@/lib/mail/signature-shared";
import { FUNKTION_LABEL, type Funktion } from "@/lib/rights-shared";
import { SignatureEditor } from "./editor";

export const metadata = { title: "Mail-Signatur" };
export const dynamic = "force-dynamic";

export default async function SignaturePage() {
  const u = await requireArea("mail");
  const cfg = await signatureConfig();
  const mc = mailConfig();
  const mine = cfg.users[u.id] ?? { ...personSchema.parse({}), position: u.funktion ? (FUNKTION_LABEL[u.funktion as Funktion] ?? "") : "" };
  const { users, ...company } = cfg;
  const others = u.role === "ADMIN" ? await db.user.findMany({ where: { id: { in: Object.keys(users).filter((id) => id !== u.id) } }, select: { name: true } }) : [];

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10" data-wide>
      <Link href="/mail" className="inline-flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft className="size-4" /> Posteingang
      </Link>
      <div>
        <h1 className="page-title">Mail-Signatur</h1>
        <p className="mt-1 text-sm text-steel">
          Wird beim Senden aus Jarvis automatisch unter jede Mail gesetzt, mit Logo und Firmendaten. {u.role === "ADMIN" ? "Den Firmenteil stellst du für alle ein, Name, Position und Telefon pflegt jeder selbst." : "Deinen Namen, deine Position und deine Durchwahl pflegst du hier selbst, den Firmenteil stellt der Administrator ein."}
        </p>
        {others.length > 0 && <p className="mt-1 text-xs text-steel">Eigene Angaben haben auch: {others.map((o) => o.name).join(", ")}.</p>}
      </div>
      <SignatureEditor
        isAdmin={u.role === "ADMIN"}
        name={u.name}
        email={u.email.endsWith(".invalid") ? "" : u.email}
        mailbox={mc ? mailAddress(mc) : COMPANY.email}
        company={COMPANY}
        initialCompany={company}
        initialPerson={mine}
      />
    </main>
  );
}
