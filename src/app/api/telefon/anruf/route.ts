import { db } from "@/lib/db";
import { firstName } from "@/lib/auth/user";
import { readLicense } from "@/lib/license";
import { forbidden, gatherPin, hangup, normalizePhone, say, twilioRequest, twiml } from "@/lib/phone";

// Twilio „A call comes in“ (Webhook, POST): Anrufer erkennen und nach der PIN fragen
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = await twilioRequest(req);
  if (!p) return forbidden();
  if (!(await readLicense()).ok) return twiml(say("Hallo, hier ist Jarvis von ProMont. Ich bin gerade nicht freigeschaltet. Bitte ruf im Büro an."), hangup());
  const from = normalizePhone(p.From ?? "");
  const user = from ? await db.user.findFirst({ where: { phone: from }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, phonePinHash: true } }) : null;
  if (!user) return twiml(say("Hallo, hier ist Jarvis von ProMont. Diese Nummer ist für mich nicht freigeschaltet. Bitte ruf im Büro an."), hangup());
  if (!user.phonePinHash) return twiml(say(`Hallo ${firstName(user.name)}. Bitte leg zuerst in der Jarvis-App unter Einstellungen eine Telefon-PIN fest.`), hangup());
  const hourAgo = new Date(Date.now() - 3600_000);
  const fails = await db.phoneCall.aggregate({ where: { userId: user.id, createdAt: { gte: hourAgo } }, _sum: { pinTries: true } });
  if ((fails._sum.pinTries ?? 0) >= 6) return twiml(say("Zu viele falsche PIN-Eingaben. Der Telefonzugang ist für eine Stunde gesperrt."), hangup());
  await db.phoneCall.upsert({ where: { callSid: p.CallSid }, create: { callSid: p.CallSid, fromNo: from!, userId: user.id }, update: {} });
  return twiml(gatherPin(say(`Hallo ${firstName(user.name)}, hier ist Jarvis. Bitte gib deine PIN ein und drück die Raute-Taste.`)), say("Ich habe keine Eingabe bekommen. Bis bald."), hangup());
}
