import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

// Dateien (Dokumente, Baustellenfotos, Belege) liegen in der Datenbank – für einen Handwerksbetrieb
// reicht das und es braucht keinen zusätzlichen Speicher. Text aus PDFs wird für die Suche ausgelesen.

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DOC_TYPES = ["application/pdf", "text/plain", "text/csv", "text/markdown", ...IMAGE_TYPES];
/** CAD-Formate nur für Zeichnungen – werden immer als Download ausgeliefert */
export const CAD_TYPES = ["image/vnd.dxf", "image/vnd.dwg", "model/step", "model/ifc"];
const CAD_EXT: Record<string, string> = { dxf: "image/vnd.dxf", dwg: "image/vnd.dwg", step: "model/step", stp: "model/step", ifc: "model/ifc" };

export class FileError extends Error {}

/** Text aus PDF/Text-Dateien (max. 200.000 Zeichen) */
export async function extractText(mime: string, data: Buffer): Promise<string | null> {
  try {
    if (mime === "application/pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await pdfText(pdf, { mergePages: true });
      return (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 200_000) || null;
    }
    if (mime.startsWith("text/")) return data.toString("utf8").slice(0, 200_000);
  } catch (e) {
    console.warn("[dateien] Text nicht lesbar:", e instanceof Error ? e.message : e);
  }
  return null;
}

/** Typ aus Dateiendung, falls der Browser nichts schickt */
export function guessMime(name: string, given?: string) {
  if (given && given !== "application/octet-stream") return given;
  const ext = name.toLowerCase().split(".").pop();
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", txt: "text/plain", csv: "text/csv", md: "text/markdown" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

export async function storeFile(f: { name: string; mime: string; data: Buffer; kind: "dokument" | "foto" | "beleg" | "spesen" | "zeichnung"; projectId?: string | null; uploadedBy?: string | null }) {
  const cad = f.kind === "zeichnung" ? CAD_EXT[f.name.toLowerCase().split(".").pop() ?? ""] : undefined;
  const mime = cad ?? guessMime(f.name, f.mime);
  if (!f.data.length) throw new FileError("Die Datei ist leer.");
  if (f.data.length > MAX_FILE_BYTES) throw new FileError("Die Datei ist größer als 15 MB.");
  if (!DOC_TYPES.includes(mime) && !cad) throw new FileError(f.kind === "zeichnung" ? "Nur PDF, Bilder oder CAD-Dateien (DXF, DWG, STEP, IFC)." : "Nur PDF, Bilder (JPG/PNG/WebP) und Textdateien.");
  if ((f.kind === "foto" || f.kind === "beleg") && !IMAGE_TYPES.includes(mime) && mime !== "application/pdf") throw new FileError("Bitte ein Foto oder PDF.");
  const sha256 = createHash("sha256").update(f.data).digest("hex");
  const text = await extractText(mime, f.data);
  return db.storedFile.create({
    data: { name: f.name.slice(0, 200) || "Datei", mime, size: f.data.length, sha256, data: new Uint8Array(f.data), kind: f.kind, projectId: f.projectId || null, uploadedBy: f.uploadedBy ?? null, text },
    select: { id: true, name: true, mime: true, size: true, kind: true, sha256: true, text: true, projectId: true },
  });
}

/** Ausschnitt rund um den ersten Treffer */
function snippet(text: string | null, words: string[]) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const pos = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((x) => x >= 0), text.length));
  if (pos >= text.length) return text.slice(0, 160).replace(/\s+/g, " ");
  return `${pos > 60 ? "…" : ""}${text.slice(Math.max(0, pos - 60), pos + 140).replace(/\s+/g, " ")}…`;
}

/** Volltextsuche über Name, Inhalt und Beschreibung (alle Wörter müssen vorkommen) */
export async function searchFiles(q: string, opts: { projectId?: string; kind?: string; take?: number } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  const rows = await db.storedFile.findMany({
    where: {
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" as const } }, { text: { contains: w, mode: "insensitive" as const } }, { summary: { contains: w, mode: "insensitive" as const } }] })),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 30,
    select: { id: true, name: true, mime: true, size: true, kind: true, text: true, summary: true, createdAt: true, project: { select: { id: true, name: true } } },
  });
  return rows.map(({ text, ...r }) => ({ ...r, snippet: snippet(text ?? r.summary, words) }));
}

export const fileUrl = (id: string, download = false) => `/api/dateien/${id}${download ? "?download=1" : ""}`;
