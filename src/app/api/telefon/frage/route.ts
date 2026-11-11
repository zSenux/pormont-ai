import { after } from "next/server";
import { db } from "@/lib/db";
import { answerOnPhone } from "@/lib/phone-turn";
import { forbidden, gatherSpeech, hangup, isGoodbye, redirect, say, twilioRequest, twiml, verifiedCall } from "@/lib/phone";

// Gesprochene Frage (Twilio-Spracherkennung) → Jarvis im Hintergrund, Twilio wartet unter /api/telefon/warten
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_TURNS = 40;

export async function POST(req: Request) {
  const p = await twilioRequest(req);
  if (!p) return forbidden();
  const call = await verifiedCall(p.CallSid);
  if (!call) return twiml(hangup());
  const text = (p.SpeechResult ?? "").trim().slice(0, 2000);
  if (!text) return twiml(gatherSpeech(say("Ich habe nichts verstanden. Was kann ich für dich tun?")), say("Dann bis bald."), hangup());
  if (isGoodbye(text)) return twiml(say("Alles klar. Bis bald!"), hangup());
  if (call.turns >= MAX_TURNS) return twiml(say("Das Gespräch ist schon sehr lang. Ruf gern noch einmal an. Tschüss!"), hangup());
  const claim = await db.phoneCall.updateMany({ where: { id: call.id, state: { not: "busy" } }, data: { state: "busy", reply: null } });
  if (claim.count) after(() => answerOnPhone(call.id, text).catch((e) => console.error("[telefon]", e)));
  return twiml(say("Moment."), redirect("/api/telefon/warten"));
}
