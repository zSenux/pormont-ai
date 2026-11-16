import "server-only";
import { headers } from "next/headers";
import { msCallbackPath } from "./microsoft";

/** Öffentliche Adresse der App (PUBLIC_URL oder aus den Kopfzeilen des Proxys) */
export async function publicOrigin() {
  const fixed = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (fixed) return fixed;
  const h = await headers();
  return `${h.get("x-forwarded-proto")?.split(",")[0] || "https"}://${h.get("x-forwarded-host") || h.get("host")}`;
}

/** Weiterleitungs-URI, die genau so in der App-Registrierung bei Microsoft stehen muss */
export const msRedirectUri = async () => `${await publicOrigin()}${msCallbackPath}`;
