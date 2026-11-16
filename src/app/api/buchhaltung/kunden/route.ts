import type { Prisma } from "@/generated/prisma/client";
import { canArea } from "@/lib/rights-shared";
import { currentUser } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Kundenliste als CSV für Excel (gleiche Filter wie die Liste) – nur lesen */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new Response("Nicht angemeldet.", { status: 401 });
  if (!canArea(me, "buchhaltung")) return new Response("Keine Berechtigung.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const b = sp.get("b") ?? "";
  const and: Prisma.CustomerWhereInput[] = [];
  if (b === "#") and.push({ NOT: LETTERS.map((l) => ({ name: { startsWith: l, mode: "insensitive" as const } })) });
  else if (LETTERS.includes(b)) and.push({ name: { startsWith: b, mode: "insensitive" } });
  if (q) {
    const n = /^\d{1,9}$/.test(q) ? Number(q) : null;
    and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { street: { contains: q, mode: "insensitive" } }, { zip: { startsWith: q } }, { email: { contains: q, mode: "insensitive" } }, ...(n ? [{ number: n }] : [])] });
  }
  const list = await db.customer.findMany({ where: { archived: sp.get("archiv") === "1", ...(and.length ? { AND: and } : {}) }, orderBy: { name: "asc" }, take: 10_000 });
  return csvResponse(
    "Kunden.csv",
    ["Kd-Nr.", "Art", "Firma / Name", "Anrede", "Vorname", "Nachname", "Ansprechpartner", "Straße", "PLZ", "Ort", "Land", "Telefon", "E-Mail", "USt-IdNr.", "Zahlungsziel (Tage)", "Quelle"],
    list.map((c) => [c.number ?? "", c.kind === "FIRMA" ? "Firma" : "Person", c.name, c.salutation ?? "", c.firstName ?? "", c.lastName ?? "", c.contactName ?? "", c.street ?? "", c.zip ?? "", c.city ?? "", c.country, c.phone ?? "", c.email ?? "", c.vatId ?? "", c.paymentDays ?? "", c.lexId ? "Lexware" : "Jarvis"]),
  );
}
