import "server-only";
import { db } from "@/lib/db";
import { jarvisError, runJarvis, speakable } from "@/lib/jarvis/agent";
import { sendPush } from "@/lib/push";

// Eine Frage am Telefon beantworten: läuft im Hintergrund (Twilio wartet höchstens 15 s auf eine Antwort),
// die Antwort landet in PhoneCall.reply und wird von /api/telefon/warten vorgelesen.

export async function answerOnPhone(callId: string, text: string) {
  const call = await db.phoneCall.findUniqueOrThrow({ where: { id: callId } });
  const user = call.userId ? await db.user.findUnique({ where: { id: call.userId }, select: { id: true, name: true } }) : null;
  if (!user || !call.chatId) return;
  let reply: string;
  try {
    const r = await runJarvis({ chatId: call.chatId, userId: user.id, userName: user.name, input: text, voice: true, phone: true });
    reply = speakable(r.reply) || "Okay.";
    if (r.actions.length) {
      const actions = await db.pendingAction.findMany({ where: { id: { in: r.actions } }, select: { summary: true } });
      for (const a of actions) await sendPush({ title: "Jarvis: Freigabe nötig", body: a.summary.slice(0, 180), url: `/jarvis?chat=${call.chatId}`, tag: `telefon-${callId}`, userId: user.id }).catch(() => {});
    }
  } catch (e) {
    console.error("[telefon]", e);
    reply = jarvisError(e);
  }
  await db.phoneCall.update({ where: { id: callId }, data: { state: "ready", reply: reply.slice(0, 2500), turns: { increment: 1 } } });
}
