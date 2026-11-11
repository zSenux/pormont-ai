import { cancelJob } from "@/lib/pc";
import { withUser } from "../../../_util";

export const dynamic = "force-dynamic";

/** Auftrag stoppen (Handy, Browser oder Not-Aus am PC) */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUser((u) => cancelJob(u.id, id));
}
