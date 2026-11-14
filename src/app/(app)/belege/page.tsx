import { redirect } from "next/navigation";

// Früher: Belegliste aus Lexware. Seit der eigenen Buchhaltung liegt alles unter /buchhaltung.
export default async function BelegePage({ searchParams }: { searchParams: Promise<{ art?: string; status?: string }> }) {
  const sp = await searchParams;
  const art = sp.art === "angebote" ? "angebote" : sp.art === "gutschriften" ? "gutschriften" : "rechnungen";
  redirect(`/buchhaltung/belege?art=${art}${sp.status ? `&status=${encodeURIComponent(sp.status)}` : ""}`);
}
