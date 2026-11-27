"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogOut } from "lucide-react";

// Status neu vom Server holen: beim Zurückkehren ins Fenster und jede Minute – so verschwindet die Sperre
// nach dem Freischalten in Klaic OS ohne Neuladen (wichtig für Windows-App und iPhone-App)
export function useLicenseRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
}

/** Von Klaic Media gesperrt: die ganze App bleibt sichtbar, aber grau und nicht bedienbar (inert).
 *  Anmelden geht weiter, Abmelden auch – alles andere erst nach der Freischaltung. */
export function LicenseLock({ text, kontakt, logout, children }: { text: string; kontakt: string | null; logout: () => Promise<void>; children: React.ReactNode }) {
  useLicenseRefresh();
  return (
    <>
      <div inert aria-hidden className="pointer-events-none select-none opacity-60 grayscale">
        {children}
      </div>
      <div role="alertdialog" aria-modal="true" aria-labelledby="sperre-titel" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-[1px]">
        <div className="card w-full max-w-md p-6 text-center shadow-xl">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-700">
            <LockKeyhole className="size-6" />
          </span>
          <h1 id="sperre-titel" className="mt-4 text-xl font-bold text-ink">Jarvis ist gesperrt</h1>
          <p className="mt-2 text-sm text-steel">{text}</p>
          <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-2">
            Bitte bei Klaic Media melden.
            {kontakt && <span className="mt-0.5 block font-normal">{kontakt}</span>}
          </p>
          <form action={logout} className="mt-5">
            <button className="btn-secondary w-full justify-center">
              <LogOut className="size-4" /> Abmelden
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
