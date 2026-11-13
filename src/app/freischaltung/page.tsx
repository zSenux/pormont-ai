import { redirect } from "next/navigation";
import { LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import { sessionUser, firstName } from "@/lib/auth/user";
import { license, lockReason } from "@/lib/license";
import { formatDate } from "@/lib/berlin";
import { logout } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Freischaltung" };

// Sperrseite: angemeldet, aber Jarvis ist (noch) nicht von Klaic Media freigeschaltet
export default async function FreischaltungPage() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  const s = await license();
  if (s.ok) redirect("/");
  const kontakt = process.env.KLAIC_KONTAKT;
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-2 to-brand px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/logo-weiss.svg" alt="ProMont GmbH" className="mx-auto h-24 w-auto" />
          <p className="mt-2 text-xs font-semibold tracking-[0.25em] text-sky-200 uppercase">Jarvis · KI-Assistent</p>
        </div>
        <div className="card p-6">
          <div className="mb-3 grid size-11 place-items-center rounded-full bg-brand/10 text-brand">
            <LockKeyhole className="size-5" />
          </div>
          <h1 className="text-xl font-bold text-ink">{s.status === "offen" ? "Fast geschafft" : "Jarvis ist pausiert"}</h1>
          <p className="mt-2 text-sm text-ink">
            Hallo {firstName(user.name)}. {lockReason(s)}
          </p>
          {s.status === "offen" && <p className="mt-2 text-sm text-steel">Sobald Klaic Media freigeschaltet hat, kannst du sofort loslegen – deine Anmeldung bleibt bestehen.</p>}
          {s.status === "abgelaufen" && s.bis && <p className="mt-2 text-sm text-steel">Freigeschaltet war Jarvis bis zum {formatDate(s.bis)}.</p>}
          {s.hinweis && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-ink">{s.hinweis}</p>}
          <p className="mt-3 text-sm text-steel">
            Fragen? Melde dich bei Klaic Media{kontakt ? <>: <span className="font-medium text-ink">{kontakt}</span></> : "."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href="/freischaltung" className="btn-primary">
              <RefreshCw className="size-4" /> Erneut prüfen
            </a>
            <form action={logout}>
              <button className="btn-secondary">
                <LogOut className="size-4" /> Abmelden
              </button>
            </form>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-sky-200/80">Jarvis für ProMont GmbH · bereitgestellt von Klaic Media, Mannheim</p>
      </div>
    </main>
  );
}
