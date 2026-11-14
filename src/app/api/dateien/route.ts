import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { FileError, storeFile } from "@/lib/files";
import { after } from "next/server";
import { analyzeReceipt, transcribeDocument } from "@/lib/receipts";

// Upload (multipart): files[], kind (dokument|foto|beleg), projectId?, note?
// Route-Handler statt Server-Action wegen der Dateigröße.
export const maxDuration = 120;

const meta = z.object({ kind: z.enum(["dokument", "foto", "beleg", "spesen"]), projectId: z.cuid().nullish(), note: z.string().trim().max(4000).nullish(), assemblyId: z.cuid().nullish(), phase: z.enum(["vorher", "nachher"]).nullish() });

export async function POST(req: Request) {
  const user = await currentUser();
  // Ansehen geht ohne Freischaltung, benutzen nicht
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Ungültiger Upload." }, { status: 400 });
  }
  const m = meta.safeParse({ kind: form.get("kind"), projectId: form.get("projectId") || null, note: form.get("note") || null, assemblyId: form.get("assemblyId") || null, phase: form.get("phase") || null });
  if (!m.success) return Response.json({ error: "Ungültige Angaben." }, { status: 400 });
  // Montage-Fotos: Projekt kommt aus der Montage
  if (m.data.assemblyId) {
    const asm = await db.assembly.findUnique({ where: { id: m.data.assemblyId }, select: { projectId: true } });
    if (!asm) return Response.json({ error: "Montage nicht gefunden." }, { status: 404 });
    m.data.projectId = asm.projectId;
  }
  if (m.data.projectId && !(await db.project.findUnique({ where: { id: m.data.projectId }, select: { id: true } }))) return Response.json({ error: "Projekt nicht gefunden." }, { status: 404 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 10);
  if (!files.length && !(m.data.kind === "foto" && m.data.note)) return Response.json({ error: "Keine Datei." }, { status: 400 });

  const out = [];
  try {
    for (const f of files) {
      const stored = await storeFile({ name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()), kind: m.data.kind, projectId: m.data.projectId, uploadedBy: user.name });
      let receipt = null;
      if (m.data.assemblyId) await db.storedFile.update({ where: { id: stored.id }, data: { assemblyId: m.data.assemblyId, meta: { phase: m.data.phase ?? "nachher" } } });
      if (m.data.kind === "beleg" || m.data.kind === "spesen") receipt = await analyzeReceipt(stored.id).catch((e) => (console.error("[beleg]", e), null));
      // Scans ohne Text im Hintergrund abschreiben lassen (Suche)
      if (m.data.kind === "dokument" && !stored.text) after(() => transcribeDocument(stored.id).catch((e) => console.error("[dokument]", e)));
      if (m.data.kind === "foto" && m.data.projectId) await db.projectNote.create({ data: { projectId: m.data.projectId, fileId: stored.id, text: files.length === 1 ? m.data.note : null, authorName: user.name } });
      out.push({ id: stored.id, name: stored.name, hasText: Boolean(stored.text), receipt });
    }
    if (m.data.kind === "foto" && m.data.projectId && m.data.note && files.length !== 1) await db.projectNote.create({ data: { projectId: m.data.projectId, text: m.data.note, authorName: user.name } });
    if (m.data.projectId) await db.project.update({ where: { id: m.data.projectId }, data: { updatedAt: new Date() } });
  } catch (e) {
    if (e instanceof FileError) return Response.json({ error: e.message, files: out }, { status: 400 });
    console.error("[upload]", e);
    return Response.json({ error: "Upload fehlgeschlagen.", files: out }, { status: 500 });
  }
  return Response.json({ files: out });
}
