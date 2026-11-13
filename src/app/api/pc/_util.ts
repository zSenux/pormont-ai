import { currentUser, lockedResponse } from "@/lib/auth/user";
import { PcError } from "@/lib/pc";

// Gemeinsame Helfer der PC-Schnittstelle: Anmeldung über die Sitzung (Web-App und Windows-App), deutsche Fehler.

export async function withUser<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  // Computer-Steuerung erst nach Freischaltung durch Klaic Media
  const locked = await lockedResponse();
  if (locked) return locked;
  try {
    const out = await fn(user);
    return out instanceof Response ? out : Response.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof PcError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[pc]", e);
    return Response.json({ error: "Fehler auf dem Server." }, { status: 500 });
  }
}

export const bad = (msg = "Ungültige Eingabe.") => Response.json({ error: msg }, { status: 400 });
export const isWindowsApp = (req: Request) => /JarvisPromont\//.test(req.headers.get("user-agent") ?? "");
