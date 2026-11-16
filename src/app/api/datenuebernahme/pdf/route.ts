import { z } from "zod";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { attachPdf, ErpImportError } from "@/lib/erp-import";
import { MAX_FILE_BYTES } from "@/lib/files";

// Beleg-PDF aus dem alten Programm hochladen (multipart: file, importId optional) – je Anfrage eine Datei, nur Admin
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Nur für Admins." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 100_000) return Response.json({ error: "Das PDF ist größer als 15 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Keine Datei." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "Das PDF ist größer als 15 MB." }, { status: 413 });
  const importId = z.cuid().nullable().catch(null).parse(form?.get("importId") || null);
  try {
    const r = await attachPdf({ importId, fileName: file.name, data: Buffer.from(await file.arrayBuffer()), userName: user.name });
    return Response.json(r);
  } catch (e) {
    if (e instanceof ErpImportError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[datenuebernahme/pdf]", e);
    return Response.json({ error: "Hochladen fehlgeschlagen." }, { status: 500 });
  }
}
