import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { jarvisError, MAX_MESSAGES, runJarvis, type JarvisEvent } from "@/lib/jarvis/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Laufende Durchgänge je Chat. Reißt die Verbindung ab (Handy gesperrt, Funkloch, Proxy), arbeitet Jarvis
// trotzdem weiter und speichert den Verlauf; die App fragt per GET nach, bis der Durchgang fertig ist.
const running = new Map<string, { userId: string; since: number }>();

/** Läuft für diesen Chat noch ein Durchgang? (für die App nach einem Verbindungsabbruch) */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("chat") ?? "";
  const r = running.get(id);
  return Response.json({ running: Boolean(r && r.userId === user.id && Date.now() - r.since < 30 * 60_000) });
}

const input = z.object({ chatId: z.cuid().nullish(), text: z.string().trim().min(1).max(8000), voice: z.boolean().optional(), source: z.enum(["web", "windows", "handy"]).optional() });

/** Ein Durchgang mit Jarvis als Server-Sent Events: chat → text/tool/action … → done | error */
export async function POST(req: Request) {
  const user = await currentUser();
  // Ansehen geht ohne Freischaltung, benutzen nicht
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const { text, voice = false, source = "web" } = parsed.data;

  let chat = parsed.data.chatId ? await db.chat.findFirst({ where: { id: parsed.data.chatId, userId: user.id } }) : null;
  if (chat && Array.isArray(chat.messages) && chat.messages.length >= MAX_MESSAGES) chat = null;
  // Verläufe von PC-Aufträgen enthalten Bildschirm-Werkzeuge → im Chat eine neue Unterhaltung beginnen
  if (chat?.source === "pc") chat = null;
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
      // Lebenszeichen alle 10 s: lange Werkzeuge (z. B. viele PDFs auslesen) senden sonst minutenlang nichts,
      // und Safari/Proxys brechen stille Verbindungen ab („Load failed“).
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {}
      }, 10_000);
      let current = chatId;
      running.set(current, { userId: user.id, since: Date.now() });
      const run = (id: string) =>
        runJarvis({
          chatId: id,
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
      try {
        let r;
        try {
          r = await run(chatId);
        } catch (e) {
          // 400 = Anfrage ungültig, meist ein kaputter Verlauf. Alter Verlauf bleibt unverändert (append-only),
          // die Frage läuft einmal in einer neuen Unterhaltung.
          const hadHistory = Array.isArray(chat.messages) && chat.messages.length > 0;
          if (!(e instanceof Anthropic.BadRequestError) || !hadHistory) throw e;
          console.error("[jarvis] 400 im bisherigen Verlauf, neue Unterhaltung:", e.message);
          const fresh = await db.chat.create({ data: { userId: user.id, source, title: text.slice(0, 80) } });
          running.delete(current);
          current = fresh.id;
          running.set(current, { userId: user.id, since: Date.now() });
          send("chat", { id: fresh.id });
          r = await run(fresh.id);
        }
        send("done", { reply: r.reply, actions: r.actions });
      } catch (e) {
        console.error("[jarvis]", e);
        send("error", { message: jarvisError(e) });
      } finally {
        clearInterval(ping);
        running.delete(current);
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
