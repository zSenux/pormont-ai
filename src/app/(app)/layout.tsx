import { requireUser } from "@/lib/auth/user";
import { MobileHeader, MobileNav, TopNav } from "@/components/nav";
import { InstallHint } from "@/components/pwa";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <TopNav name={user.name} />
      <MobileHeader />
      <InstallHint />
      {children}
      <MobileNav />
    </div>
  );
}
