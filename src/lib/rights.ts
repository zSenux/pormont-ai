import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/user";
import { canArea, type Area } from "@/lib/rights-shared";

export * from "@/lib/rights-shared";

/** Für Seiten (Layout eines Bereichs) und Server-Actions: ohne Recht → Übersicht mit Hinweis */
export async function requireArea(area: Area) {
  const u = await requireUser();
  if (!canArea(u, area)) redirect(`/?keinrecht=${area}`);
  return u;
}
