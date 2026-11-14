import { requireArea } from "@/lib/rights";

// Rollen & Rechte: Zeichnungen gehören zum Bereich Projekte
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireArea("projekte");
  return children;
}
