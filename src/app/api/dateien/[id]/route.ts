import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/user";
import { IMAGE_TYPES } from "@/lib/files";
import { canArea } from "@/lib/rights-shared";

// Datei ausliefern: Bilder und PDF im Browser, alles andere als Download. Nie HTML/SVG inline.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const { id } = await params;
  const f = await db.storedFile.findUnique({ where: { id }, select: { name: true, mime: true, data: true, kind: true } });
  if (!f) return Response.json({ error: "Nicht gefunden." }, { status: 404 });
  // Personalakte nur für Admins, Nachweise der Nachunternehmer nur mit Recht auf den Einkauf, Kontoauszüge nur mit Recht auf die Buchhaltung
  if ((f.kind === "personal" && me.role !== "ADMIN") || (f.kind === "nachunternehmer" && !canArea(me, "einkauf")) || ((f.kind === "kontoauszug" || f.kind === "altbeleg") && !canArea(me, "buchhaltung"))) return Response.json({ error: "Nicht gefunden." }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const inline = !download && (IMAGE_TYPES.includes(f.mime) || f.mime === "application/pdf");
  const name = f.name.replace(/[\r\n"\\]/g, "_");
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      ...(f.mime === "application/pdf" && inline ? {} : { "Content-Security-Policy": "sandbox" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
