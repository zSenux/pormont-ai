import { requireArea } from "@/lib/rights";

// Rollen & Rechte: Bereich Akquise (siehe src/lib/rights-shared.ts)
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireArea("akquise");
  return children;
}
