import { z } from "zod";
import { klaicKeyOk, klaicKeySet, licenseInput, readLicense, setLicense } from "@/lib/license";

// Freischaltung per Skript (z. B. aus Klaic OS): Authorization: Bearer <KLAIC_KEY>
// GET = Status, POST {"aktiv": true|false, "bis"?: "2027-12-31", "hinweis"?: "…"} = freischalten/sperren
export const dynamic = "force-dynamic";

const fails = new Map<string, { n: number; until: number }>();

function auth(req: Request) {
  if (!klaicKeySet()) return Response.json({ error: "KLAIC_KEY ist nicht gesetzt." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "lokal";
  const f = fails.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) return Response.json({ error: "Zu viele Fehlversuche." }, { status: 429 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!klaicKeyOk(token)) {
    fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 30 * 60_000 });
    return Response.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  fails.delete(ip);
  return null;
}

export async function GET(req: Request) {
  return auth(req) ?? Response.json(await readLicense());
}

export async function POST(req: Request) {
  const denied = auth(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const p = licenseInput.safeParse(body);
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 });
  return Response.json(await setLicense(p.data));
}
