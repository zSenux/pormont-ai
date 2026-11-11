import { requireUser, firstName } from "@/lib/auth/user";
import { loadChat } from "@/lib/jarvis/load";
import { JarvisChat } from "@/components/jarvis/chat";

// Kompaktes Jarvis-Fenster für die Windows-App (Strg+Leertaste) – ohne Navigation
export const metadata = { title: "Jarvis" };
export const dynamic = "force-dynamic";

export default async function FensterPage({ searchParams }: { searchParams: Promise<{ chat?: string; sprechen?: string; neu?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await loadChat(user.id, sp.chat, Boolean(sp.neu));
  return <JarvisChat key={data.chatId ?? "neu"} compact userName={firstName(user.name)} chatId={data.chatId} initialMessages={data.messages} initialActions={data.actions} recentChats={data.recent} autoListen={sp.sprechen === "1"} />;
}
