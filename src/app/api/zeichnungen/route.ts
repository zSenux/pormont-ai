import { z } from "zod";
import { currentUser, lockedResponse } from "@/lib/auth/user";
import { canArea } from "@/lib/rights-shared";
import { FileError } from "@/lib/files";
import { addVersion, createDrawing, DrawingError } from "@/lib/drawings";
import { DRAWING_KINDS } from "@/lib/drawings-shared";

// Zeichnung hochladen (multipart): neue Zeichnung (projectId, title, kind) oder neuer Index (drawingId); file, note?
export const maxDuration = 60;

const meta = z.union([
  z.object({ drawingId: z.cuid(), note: z.string().trim().max(1000).nullish() }),
  z.object({ projectId: z.cuid(), title: z.string().trim().min(2).max(200), kind: z.enum(DRAWING_KINDS).default("WERKPLAN"), note: z.string().trim().max(1000).nullish() }),
]);

export async function POST(req: Request) {
  const user = await currentUser();
  const locked = user ? await lockedResponse() : null;
  if (locked) return locked;
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canArea(user, "projekte")) return Response.json({ error: "Keine Berechtigung." }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Ungültiger Upload." }, { status: 400 });
  }
  const get = (k: string) => (typeof form.get(k) === "string" && String(form.get(k)).trim() ? String(form.get(k)) : undefined);
  const m = meta.safeParse({ drawingId: get("drawingId"), projectId: get("projectId"), title: get("title"), kind: get("kind"), note: get("note") });
  if (!m.success) return Response.json({ error: "Bitte Titel und Projekt angeben." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Bitte eine Datei auswählen." }, { status: 400 });
  const upload = { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) };
  try {
    const d = "drawingId" in m.data ? await addVersion(m.data.drawingId, { note: m.data.note, file: upload }, user) : await createDrawing({ ...m.data, file: upload }, user);
    return Response.json({ id: d.id, number: d.number, version: d.currentVersion });
  } catch (e) {
    if (e instanceof FileError || e instanceof DrawingError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[zeichnung]", e);
    return Response.json({ error: "Upload fehlgeschlagen." }, { status: 500 });
  }
}
