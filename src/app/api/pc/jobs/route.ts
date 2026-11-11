import { z } from "zod";
import { createJob, pcState } from "@/lib/pc";
import { bad, isWindowsApp, withUser } from "../_util";

export const dynamic = "force-dynamic";

/** Lage: PCs + letzte Aufträge (Seite /pc fragt alle paar Sekunden) */
export async function GET() {
  return withUser((u) => pcState(u.id));
}

const input = z.object({ prompt: z.string().trim().min(2).max(4000), deviceId: z.uuid().nullish() });

/** Neuer Auftrag an den PC. Aus der Windows-App selbst = Rückfragen als Dialog am PC. */
export async function POST(req: Request) {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Bitte sag, was Jarvis am PC tun soll.");
  const origin = isWindowsApp(req) ? "pc" : "remote";
  return withUser(async (u) => {
    const job = await createJob(u.id, parsed.data.prompt, { deviceId: parsed.data.deviceId, origin });
    return { id: job.id };
  });
}
