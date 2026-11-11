import { db } from "@/lib/db";
import { ownJob } from "@/lib/pc";
import { jarvisError } from "@/lib/jarvis/agent";
import { pcStep, stepInput } from "@/lib/jarvis/pc-agent";
import { finishJob } from "@/lib/pc";
import { bad, withUser } from "../../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nächster Schritt: App schickt Ergebnisse ihrer Werkzeuge, bekommt neue Werkzeug-Aufrufe oder das Ende */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = stepInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  return withUser(async (u) => {
    await ownJob(u.id, id);
    if (parsed.data.screenshot) await db.pcJob.update({ where: { id }, data: { screenshot: parsed.data.screenshot } });
    try {
      return await pcStep(id, parsed.data.results, u.name);
    } catch (e) {
      console.error("[pc-step]", e);
      const msg = e instanceof Error && /Ergebnisse|offenen Schritt/.test(e.message) ? e.message : jarvisError(e);
      await finishJob(id, "ERROR", msg);
      return { done: true, reply: msg, error: true };
    }
  });
}
