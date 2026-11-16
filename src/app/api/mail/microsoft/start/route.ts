import { cookies } from "next/headers";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { msAuthorizeUrl } from "@/lib/mail/microsoft";
import { msRedirectUri, publicOrigin } from "@/lib/mail/origin";
import { MailError } from "@/lib/mail/types";

export const dynamic = "force-dynamic";

/** „Mit Microsoft anmelden“ (nur Admin): leitet zur Microsoft-Anmeldung, state + PKCE im kurzlebigen Cookie */
export async function GET() {
  const u = await currentUser();
  if (!u) return new Response("Nicht angemeldet.", { status: 401 });
  if (u.role !== "ADMIN") return new Response("Nur für Administratoren.", { status: 403 });
  const locked = await lockedResponse();
  if (locked) return locked;
  try {
    const a = msAuthorizeUrl(await msRedirectUri());
    (await cookies()).set("pm_ms_login", `${a.state}.${a.verifier}.${u.id}`, { httpOnly: true, secure: (await publicOrigin()).startsWith("https:"), sameSite: "lax", path: "/api/mail/microsoft", maxAge: 600 });
    return Response.redirect(a.url, 302);
  } catch (e) {
    const msg = e instanceof MailError ? e.message : "Anmeldung konnte nicht gestartet werden.";
    return Response.redirect(`${await publicOrigin()}/einstellungen?microsoft=${encodeURIComponent(msg)}#verbindungen`, 302);
  }
}
