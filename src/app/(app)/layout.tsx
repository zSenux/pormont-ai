import { Suspense } from "react";
import { requireUser } from "@/lib/auth/user";
import { MobileHeader, MobileNav, TopNav } from "@/components/nav";
import { InstallHint } from "@/components/pwa";
import { license, lockReason } from "@/lib/license";
import { LicenseBanner } from "@/components/license-banner";
import { addDaysYmd, formatDate, todayYmd } from "@/lib/berlin";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Befristete Freischaltung: Administratoren 14 Tage vorher erinnern
  const lic = await license();
  const soon = lic.ok && user.role === "ADMIN" && lic.bis && lic.bis <= addDaysYmd(todayYmd(), 14);
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <TopNav name={user.name} />
      <MobileHeader />
      {!lic.ok && (
        <Suspense>
          <LicenseBanner tone={lic.status === "offen" ? "info" : "bad"} text={lockReason(lic)} kontakt={process.env.KLAIC_KONTAKT ?? null} />
        </Suspense>
      )}
      <InstallHint />
      {soon && (
        <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          Die Freischaltung von Jarvis läuft am {formatDate(lic.bis)} ab. Bitte melde dich bei Klaic Media.
        </p>
      )}
      {children}
      <MobileNav />
    </div>
  );
}
