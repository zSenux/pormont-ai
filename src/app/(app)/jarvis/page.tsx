import { requireUser, firstName } from "@/lib/auth/user";
import { loadChat } from "@/lib/jarvis/load";
import { JarvisChat } from "@/components/jarvis/chat";

export const metadata = { title: "Jarvis" };
export const dynamic = "force-dynamic";

export default async function JarvisPage({ searchParams }: { searchParams: Promise<{ chat?: string; q?: string; sprechen?: string; neu?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await loadChat(user.id, sp.chat, Boolean(sp.neu || sp.q));
  return <JarvisChat key={data.chatId ?? "neu"} userName={firstName(user.name)} chatId={data.chatId} initialMessages={data.messages} initialActions={data.actions} recentChats={data.recent} autoQuery={sp.q?.slice(0, 500)} autoListen={sp.sprechen === "1"} />;
}
