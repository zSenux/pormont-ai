import { db } from "@/lib/db";
import { ownJob } from "@/lib/pc";
import { withUser } from "../../_util";

export const dynamic = "force-dynamic";

/** Stand eines Auftrags (App wartet hier auf Entscheidungen, die Seite zeigt Fortschritt und Bildschirmfoto) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const withShot = new URL(req.url).searchParams.get("bild") === "1";
  return withUser(async (u) => {
    await ownJob(u.id, id);
    return db.pcJob.findUnique({
      where: { id },
      select: { id: true, status: true, prompt: true, origin: true, lines: true, reply: true, confirm: true, decision: true, controlOk: true, chatId: true, createdAt: true, finishedAt: true, screenshot: withShot },
    });
  });
}
