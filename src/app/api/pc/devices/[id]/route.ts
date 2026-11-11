import { z } from "zod";
import { db } from "@/lib/db";
import { ownDevice, setView } from "@/lib/pc";
import { bad, withUser } from "../../_util";

export const dynamic = "force-dynamic";

const input = z.object({ view: z.boolean().optional(), name: z.string().trim().min(1).max(80).optional() });

/** Live-Bild an/aus, umbenennen */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  return withUser(async (u) => {
    await ownDevice(u.id, id);
    if (parsed.data.view !== undefined) await setView(u.id, id, parsed.data.view);
    if (parsed.data.name) await db.pcDevice.update({ where: { id }, data: { name: parsed.data.name } });
    return { ok: true };
  });
}

/** PC entfernen (meldet er sich wieder, taucht er neu auf) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUser(async (u) => {
    await ownDevice(u.id, id);
    await db.pcDevice.delete({ where: { id } });
    return { ok: true };
  });
}
