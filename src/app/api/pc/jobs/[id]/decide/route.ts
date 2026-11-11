import { z } from "zod";
import { db } from "@/lib/db";
import { decide, ownJob } from "@/lib/pc";
import { bad, withUser } from "../../../_util";

export const dynamic = "force-dynamic";

const input = z.object({ yes: z.boolean() });

/** Freigeben/Ablehnen einer Rückfrage vom Handy oder Browser */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  return withUser(async (u) => {
    const job = await ownJob(u.id, id);
    const control = Boolean((job.confirm as { control?: boolean } | null)?.control);
    await decide(u.id, id, parsed.data.yes);
    if (control && parsed.data.yes) await db.pcJob.update({ where: { id }, data: { controlOk: true } });
    return { ok: true };
  });
}
