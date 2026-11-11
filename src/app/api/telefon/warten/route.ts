import { db } from "@/lib/db";
import { forbidden, gatherSpeech, hangup, pause, redirect, say, twilioRequest, twiml, verifiedCall } from "@/lib/phone";

// Wartet bis zu ~8 s auf Jarvis' Antwort, liest sie vor und hört wieder zu. Sonst kurz Pause und erneut.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = await twilioRequest(req);
  if (!p) return forbidden();
  const call = await verifiedCall(p.CallSid);
  if (!call) return twiml(hangup());
  const until = Date.now() + 8000;
  let c = call;
  while (c.state === "busy" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    c = (await db.phoneCall.findUnique({ where: { id: call.id } })) ?? c;
  }
  if (c.state !== "ready" || !c.reply) {
    // Nach ~3 Minuten aufgeben
    if (Date.now() - c.updatedAt.getTime() > 180_000) return twiml(say("Das dauert leider zu lange. Schau gleich in die App, da steht die Antwort."), hangup());
    return twiml(pause(1), redirect("/api/telefon/warten"));
  }
  await db.phoneCall.update({ where: { id: c.id }, data: { state: "idle" } });
  return twiml(gatherSpeech(say(c.reply)), say("Bist du noch da? Dann bis bald."), hangup());
}
