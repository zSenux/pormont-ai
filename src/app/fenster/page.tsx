import { Suspense } from "react";
import { requireUser, firstName } from "@/lib/auth/user";
import { loadChat } from "@/lib/jarvis/load";
import { JarvisChat } from "@/components/jarvis/chat";
import { license, lockReason } from "@/lib/license";
import { LicenseBanner } from "@/components/license-banner";

// Kompaktes Jarvis-Fenster für die Windows-App (Strg+Leertaste) – ohne Navigation
export const metadata = { title: "Jarvis" };
export const dynamic = "force-dynamic";

export default async function FensterPage({ searchParams }: { searchParams: Promise<{ chat?: string; sprechen?: string; neu?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [data, lic] = await Promise.all([loadChat(user.id, sp.chat, Boolean(sp.neu)), license()]);
  return (
    <div className="flex h-dvh flex-col">
      {/* Ohne Freischaltung denselben Hinweis wie in der App zeigen – schon bevor man schreibt */}
      {!lic.ok && (
        <Suspense>
          <LicenseBanner tone={lic.status === "offen" ? "info" : "bad"} text={lockReason(lic)} kontakt={process.env.KLAIC_KONTAKT ?? null} />
        </Suspense>
      )}
      <JarvisChat key={data.chatId ?? "neu"} compact userName={firstName(user.name)} chatId={data.chatId} initialMessages={data.messages} initialActions={data.actions} recentChats={data.recent} autoListen={sp.sprechen === "1"} />
    </div>
  );
}
