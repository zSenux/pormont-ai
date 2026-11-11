import { z } from "zod";
import { FileError, storeFile } from "@/lib/files";
import { db } from "@/lib/db";
import { bad, withUser } from "../_util";

export const dynamic = "force-dynamic";

const meta = z.object({ name: z.string().trim().min(1).max(200), projectId: z.string().max(40).optional() });

/** Datei vom PC in Jarvis ablegen (Werkzeug pc_datei_hochladen) */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = meta.safeParse({ name: form?.get("name"), projectId: form?.get("projectId") || undefined });
  if (!(file instanceof Blob) || !parsed.success) return bad();
  return withUser(async (u) => {
    const projectId = parsed.data.projectId && (await db.project.findUnique({ where: { id: parsed.data.projectId }, select: { id: true } })) ? parsed.data.projectId : null;
    try {
      const f = await storeFile({ name: parsed.data.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), kind: "dokument", projectId, uploadedBy: u.name });
      return { id: f.id, name: f.name, hasText: Boolean(f.text) };
    } catch (e) {
      if (e instanceof FileError) return bad(e.message);
      throw e;
    }
  });
}
