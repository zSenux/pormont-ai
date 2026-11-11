import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

// Alles außer Login, Manifest, Service Worker und Symbolen braucht eine gültige Sitzung.
// Die Sitzungs-Version (Abmelden überall) prüft der Server zusätzlich in currentUser().
export async function proxy(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?weiter=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|manifest.webmanifest|sw.js|offline.html|_next/static|_next/image|favicon.png|logo.png|logo-weiss.png|icon-192.png|icon-512.png|icon-maskable.png|apple-icon.png|api/health|kalender-abo/).*)"],
};
