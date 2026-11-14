import { requireUser } from "@/lib/auth/user";
import { canArea } from "@/lib/rights-shared";
import { redirect } from "next/navigation";

// Rollen & Rechte: Bestellungen sehen Einkauf und Lager (Wareneingang)
export default async function Layout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  if (!canArea(u, "einkauf") && !canArea(u, "lager")) redirect("/?keinrecht=einkauf");
  return children;
}
