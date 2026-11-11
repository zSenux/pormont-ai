import { z } from "zod";
import { heartbeat } from "@/lib/pc";
import { bad, withUser } from "../_util";

export const dynamic = "force-dynamic";

const input = z.object({
  deviceId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  remoteEnabled: z.boolean(),
  status: z.record(z.string(), z.unknown()).default({}),
  busy: z.array(z.string().max(40)).max(10).default([]),
});

/** Lebenszeichen der Windows-App (alle paar Sekunden) */
export async function POST(req: Request) {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const status = JSON.stringify(parsed.data.status).length <= 4000 ? parsed.data.status : {};
  return withUser((u) => heartbeat(u.id, { ...parsed.data, status }));
}
