import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/user";
import { jarvisError, MAX_MESSAGES, runJarvis, type JarvisEvent } from "@/lib/jarvis/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const input = z.object({ chatId: z.cuid().nullish(), text: z.string().trim().min(1).max(8000), voice: z.boolean().optional(), source: z.enum(["web", "windows", "handy"]).optional() });

/** Ein Durchgang mit Jarvis als Server-Sent Events: chat → text/tool/action … → done | error */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const { text, voice = false, source = "web" } = parsed.data;

  let chat = parsed.data.chatId ? await db.chat.findFirst({ where: { id: parsed.data.chatId, userId: user.id } }) : null;
  if (chat && Array.isArray(chat.messages) && chat.messages.length >= MAX_MESSAGES) chat = null;
  if (!chat) chat = await db.chat.create({ data: { userId: user.id, source, title: text.slice(0, 80) } });
  const chatId = chat.id;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      send("chat", { id: chatId });
      try {
        const r = await runJarvis({
          chatId,
          userId: user.id,
          userName: user.name,
          input: text,
          voice,
          onEvent: (e: JarvisEvent) => {
            if (e.type === "text") send("text", { text: e.text });
            else if (e.type === "tool") send("tool", { name: e.name });
            else if (e.type === "action") void db.pendingAction.findUnique({ where: { id: e.id }, select: { id: true, kind: true, summary: true, status: true } }).then((a) => a && send("action", a));
          },
        });
        send("done", { reply: r.reply, actions: r.actions });
      } catch (e) {
        console.error("[jarvis]", e);
        send("error", { message: jarvisError(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
