import { z } from "zod";
import { db } from "@/lib/db";
import { ownJob, requestConfirm } from "@/lib/pc";
import { bad, withUser } from "../../../_util";

export const dynamic = "force-dynamic";

const input = z.object({ text: z.string().trim().min(1).max(300), detail: z.string().max(2000).default(""), control: z.boolean().optional(), answer: z.enum(["yes", "no"]).optional() });

/**
 * Rückfrage der App. Mit `answer` meldet die App eine am PC selbst getroffene Entscheidung (Dialog) – nur fürs Protokoll.
 * `control` = Freigabe von Maus und Tastatur für den ganzen Auftrag.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  return withUser(async (u) => {
    const job = await ownJob(u.id, id);
    if (parsed.data.answer) {
      if (parsed.data.control && parsed.data.answer === "yes") await db.pcJob.update({ where: { id }, data: { controlOk: true } });
      return { ok: true };
    }
    await requestConfirm(job, parsed.data.text, parsed.data.detail);
    if (parsed.data.control) await db.pcJob.update({ where: { id }, data: { confirm: { text: parsed.data.text, detail: parsed.data.detail, control: true } } });
    return { ok: true };
  });
}
