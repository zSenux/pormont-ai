"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/rights";
import { DrawingError, setDrawingStatus } from "@/lib/drawings";
import { canRelease, DRAWING_STATUSES } from "@/lib/drawings-shared";

// Server-Actions der Zeichnungen (Status, Freigabe, Löschen von nie freigegebenen Entwürfen)

type Result = { error?: string };

export async function drawingStatus(id: string, status: string): Promise<Result> {
  const u = await requireArea("projekte");
  const s = z.enum(DRAWING_STATUSES).parse(status);
  if (s === "FREIGEGEBEN" && !canRelease(u)) return { error: "Freigeben dürfen nur Projektleitung, Geschäftsführung oder Administratoren." };
  try {
    await setDrawingStatus(z.cuid().parse(id), s, u);
  } catch (e) {
    if (e instanceof DrawingError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/zeichnungen/${id}`);
  revalidatePath("/zeichnungen");
  return {};
}

export async function deleteDrawing(id: string) {
  await requireArea("projekte");
  const d = await db.drawing.findUnique({ where: { id: z.cuid().parse(id) }, include: { versions: { select: { fileId: true } } } });
  if (!d || d.releasedVersion) return;
  await db.$transaction([db.drawing.delete({ where: { id: d.id } }), db.storedFile.deleteMany({ where: { id: { in: d.versions.map((v) => v.fileId) } } })]);
  redirect(`/projekte/${d.projectId}`);
}
