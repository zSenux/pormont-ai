import { requireArea } from "@/lib/rights";

// Rollen & Rechte: Jahresauswertung gehört zur Buchhaltung (Monteure-Teil zusätzlich nur Admin/Geschäftsführung)
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireArea("buchhaltung");
  return children;
}
