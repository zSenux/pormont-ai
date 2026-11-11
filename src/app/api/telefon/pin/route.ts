import { db } from "@/lib/db";
import { firstName } from "@/lib/auth/user";
import { verifyPassword } from "@/lib/auth/password";
import { forbidden, gatherPin, gatherSpeech, hangup, PIN_MAX_TRIES_PER_CALL, say, twilioRequest, twiml } from "@/lib/phone";

// PIN prüfen; danach beginnt das Gespräch in einer neuen Unterhaltung („Telefon“)
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = await twilioRequest(req);
  if (!p) return forbidden();
  const call = p.CallSid ? await db.phoneCall.findUnique({ where: { callSid: p.CallSid } }) : null;
  const user = call?.userId ? await db.user.findUnique({ where: { id: call.userId }, select: { id: true, name: true, phonePinHash: true } }) : null;
  if (!call || !user?.phonePinHash) return twiml(hangup());
  if (call.verified) return twiml(gatherSpeech(say("Was kann ich für dich tun?")));
  const digits = (p.Digits ?? "").replace(/\D/g, "");
  if (digits.length >= 6 && (await verifyPassword(digits, user.phonePinHash))) {
    const chat = await db.chat.create({ data: { userId: user.id, source: "telefon", title: `Telefonat ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}` } });
    await db.phoneCall.update({ where: { id: call.id }, data: { verified: true, chatId: chat.id } });
    return twiml(gatherSpeech(say(`Danke, ${firstName(user.name)}. Was kann ich für dich tun?`)), say("Ich höre nichts. Bis bald."), hangup());
  }
  const tries = call.pinTries + 1;
  await db.phoneCall.update({ where: { id: call.id }, data: { pinTries: tries } });
  if (tries >= PIN_MAX_TRIES_PER_CALL) return twiml(say("Die PIN war leider wieder falsch. Auf Wiederhören."), hangup());
  return twiml(gatherPin(say("Die PIN stimmt nicht. Bitte noch einmal eingeben und mit Raute bestätigen.")), hangup());
}
