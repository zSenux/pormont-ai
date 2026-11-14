import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { latestWindowsRelease, windowsDownloadTarget } from "@/lib/windows-app";

export const dynamic = "force-dynamic";

// GET /api/windows-app → Weiterleitung auf den neuesten Installer; ?info=1 → Version als JSON
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (new URL(req.url).searchParams.has("info")) {
    const rel = await latestWindowsRelease();
    return NextResponse.json(rel ? { version: rel.version, name: rel.name, size: rel.size } : { version: null });
  }
  return NextResponse.redirect(await windowsDownloadTarget(), { status: 302, headers: { "Cache-Control": "no-store" } });
}
