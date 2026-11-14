import { requireArea } from "@/lib/rights";

// Rollen & Rechte: Bereich nur mit passender Funktion (siehe src/lib/rights-shared.ts)
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireArea("pc");
  return children;
}
