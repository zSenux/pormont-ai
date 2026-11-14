import { requireUser } from "@/lib/auth/user";
import { pcState } from "@/lib/pc";
import { PcView } from "./pc-view";

export const metadata = { title: "Computer" };
export const dynamic = "force-dynamic";

export default async function PcPage({ searchParams }: { searchParams: Promise<{ auftrag?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const state = await pcState(user.id);
  // Daten serialisierbar machen (Datumswerte als Text)
  return <PcView initial={JSON.parse(JSON.stringify(state))} focusJob={sp.auftrag ?? null} downloadUrl="/api/windows-app" />;
}
