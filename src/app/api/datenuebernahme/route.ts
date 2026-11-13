import { currentUser, lockedResponse } from "@/lib/auth/user";
import { ErpImportError, importExport, MAX_ERP_BYTES } from "@/lib/erp-import";

// Exportdatei aus dem alten Programm hochladen (multipart: file) – nur Admin
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  // Ansehen geht ohne Freischaltung, benutzen nicht
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Nur für Admins." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ERP_BYTES + 100_000) return Response.json({ error: "Die Datei ist größer als 25 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Keine Datei." }, { status: 400 });
  if (file.size > MAX_ERP_BYTES) return Response.json({ error: "Die Datei ist größer als 25 MB." }, { status: 413 });
  try {
    const r = await importExport({ fileName: file.name, data: Buffer.from(await file.arrayBuffer()), userName: user.name });
    return Response.json({ importId: r.id, tables: r.tables.map((t) => ({ name: t.name, kind: t.kind, rows: t.rows })) });
  } catch (e) {
    if (e instanceof ErpImportError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[datenuebernahme]", e);
    return Response.json({ error: "Import fehlgeschlagen." }, { status: 500 });
  }
}
