import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { canArea } from "@/lib/rights-shared";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { CatalogError, importCatalog, MAX_CATALOG_BYTES } from "@/lib/catalog";

// Katalog/Preisliste eines Lieferanten hochladen (multipart: file). Excel/CSV/DATANORM sofort, PDF im Hintergrund.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  // Ansehen geht ohne Freischaltung, benutzen nicht
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canArea(user, "einkauf")) return Response.json({ error: "Keine Berechtigung." }, { status: 403 });
  const id = z.cuid().safeParse((await params).id);
  if (!id.success || !(await db.supplier.findUnique({ where: { id: id.data }, select: { id: true } }))) return Response.json({ error: "Lieferant nicht gefunden." }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CATALOG_BYTES + 100_000) return Response.json({ error: "Die Datei ist größer als 40 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Keine Datei." }, { status: 400 });
  try {
    const job = await importCatalog({ supplierId: id.data, fileName: file.name, data: Buffer.from(await file.arrayBuffer()), userName: user.name });
    if (job.format === "pdf") {
      after(job.run);
      return Response.json({ importId: job.importId, background: true });
    }
    await job.run();
    const imp = await db.catalogImport.findUniqueOrThrow({ where: { id: job.importId } });
    if (imp.status === "fehler") return Response.json({ error: imp.note }, { status: 400 });
    return Response.json({ importId: imp.id, created: imp.created, updated: imp.updated });
  } catch (e) {
    if (e instanceof CatalogError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[katalog]", e);
    return Response.json({ error: "Import fehlgeschlagen." }, { status: 500 });
  }
}
