import { z } from "zod";
import { db } from "@/lib/db";
import { ownDevice } from "@/lib/pc";
import { bad, withUser } from "../_util";

export const dynamic = "force-dynamic";

const input = z.object({ deviceId: z.uuid(), image: z.string().min(100).max(3_000_000) });

/** App schickt ein Live-Bild (nur solange angefordert) */
export async function POST(req: Request) {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  return withUser(async (u) => {
    const d = await ownDevice(u.id, parsed.data.deviceId);
    if (!d.viewUntil || d.viewUntil < new Date() || !d.remoteEnabled) return { stop: true };
    await db.pcDevice.update({ where: { id: d.id }, data: { viewImage: parsed.data.image, viewAt: new Date() } });
    return { ok: true };
  });
}

/** Letztes Live-Bild als JPEG */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("pc") ?? "";
  if (!z.uuid().safeParse(id).success) return bad();
  return withUser(async (u) => {
    const d = await ownDevice(u.id, id);
    if (!d.viewImage) return new Response(null, { status: 204 });
    return new Response(Buffer.from(d.viewImage, "base64"), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
