import { requireArea } from "@/lib/rights";

// Rollen & Rechte: Nachunternehmer gehören zum Einkauf (siehe src/lib/rights-shared.ts)
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireArea("einkauf");
  return children;
}
