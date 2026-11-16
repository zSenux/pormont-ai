import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { msFinishLogin } from "@/lib/mail/microsoft";
import { msRedirectUri, publicOrigin } from "@/lib/mail/origin";
import { MailError } from "@/lib/mail/types";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Rückleitung von Microsoft: state prüfen, Code tauschen, Konto speichern → zurück zu den Einstellungen */
export async function GET(req: Request) {
  const back = async (msg: string, ok = false) => Response.redirect(`${await publicOrigin()}/einstellungen?microsoft=${encodeURIComponent(msg)}${ok ? "&ok=1" : ""}#verbindungen`, 302);
  const u = await currentUser();
  if (!u) return new Response("Nicht angemeldet.", { status: 401 });
  if (u.role !== "ADMIN") return new Response("Nur für Administratoren.", { status: 403 });
  const locked = await lockedResponse();
  if (locked) return locked;

  const jar = await cookies();
  const [state, verifier, userId] = (jar.get("pm_ms_login")?.value ?? "").split(".");
  jar.delete({ name: "pm_ms_login", path: "/api/mail/microsoft" });
  const sp = new URL(req.url).searchParams;
  if (sp.get("error")) {
    const d = sp.get("error_description") ?? sp.get("error") ?? "";
    if (/AADSTS65004|access_denied/i.test(d)) return back("Anmeldung abgebrochen oder Zustimmung verweigert.");
    if (/AADSTS50011/i.test(d)) return back("Die Weiterleitungs-URI passt nicht – in der App-Registrierung genau die angezeigte Adresse eintragen.");
    if (/AADSTS65001|consent/i.test(d)) return back("Die Firma erlaubt Benutzern keine Zustimmung – ein Microsoft-365-Administrator muss der App zustimmen (siehe Anleitung).");
    return back(`Microsoft meldet: ${d.split(/\r?\n/)[0].slice(0, 200)}`);
  }
  const code = sp.get("code");
  if (!code || !state || !verifier || userId !== u.id || !same(state, sp.get("state") ?? "")) return back("Anmeldung abgelaufen – bitte noch einmal „Mit Microsoft anmelden“ klicken.");
  try {
    const r = await msFinishLogin(code, verifier, await msRedirectUri());
    revalidatePath("/", "layout");
    return back(`Verbunden mit ${r.address}.`, true);
  } catch (e) {
    console.error("[mail] Microsoft-Anmeldung:", e instanceof Error ? e.message : e);
    return back(e instanceof MailError ? e.message : "Anmeldung fehlgeschlagen.");
  }
}
