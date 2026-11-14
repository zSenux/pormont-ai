import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

// Kunden- und Artikelstamm der Buchhaltung

const t = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const customerInput = z
  .object({
    kind: z.enum(["FIRMA", "PERSON"]).default("FIRMA"),
    company: t(200),
    salutation: t(30),
    firstName: t(100),
    lastName: t(100),
    contactName: t(150),
    email: z.email("E-Mail-Adresse prüfen.").max(200).nullish().or(z.literal("").transform(() => null)),
    phone: t(60),
    street: t(150),
    zip: t(10),
    city: t(100),
    country: z.string().trim().length(2).toUpperCase().default("DE"),
    vatId: z.string().trim().max(20).transform((s) => s.replace(/\s+/g, "").toUpperCase() || null).nullish(),
    buyerReference: t(100),
    paymentDays: z.number().int().min(0).max(120).nullish(),
    notes: t(4000),
  })
  .refine((c) => (c.kind === "FIRMA" ? Boolean(c.company) : Boolean(c.lastName)), { message: "Firma braucht einen Firmennamen, Privatperson einen Nachnamen." });
export type CustomerInput = z.infer<typeof customerInput>;

function displayName(c: CustomerInput) {
  return c.kind === "FIRMA" ? c.company! : [c.firstName, c.lastName].filter(Boolean).join(" ");
}

function customerData(c: CustomerInput) {
  return {
    kind: c.kind,
    name: displayName(c),
    salutation: c.salutation,
    firstName: c.firstName,
    lastName: c.lastName,
    contactName: c.kind === "FIRMA" ? c.contactName : null,
    email: c.email ?? null,
    phone: c.phone,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country: c.country,
    vatId: c.vatId ?? null,
    buyerReference: c.buyerReference,
    paymentDays: c.paymentDays ?? null,
    notes: c.notes,
  };
}

/** Neue Kundennummer: höchste vergebene + 1 (Start 10001). Bei gleichzeitiger Vergabe wird neu versucht. */
export async function createCustomer(input: CustomerInput, extra: { number?: number | null; lexId?: string | null } = {}) {
  const c = customerInput.parse(input);
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = extra.number ?? ((await db.customer.aggregate({ _max: { number: true } }))._max.number ?? 10000) + 1;
    try {
      return await db.customer.create({ data: { ...customerData(c), number, lexId: extra.lexId ?? null } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (extra.number) return db.customer.create({ data: { ...customerData(c), number: null, lexId: extra.lexId ?? null } });
        continue;
      }
      throw e;
    }
  }
  throw new Error("Kundennummer konnte nicht vergeben werden.");
}

export async function updateCustomer(id: string, input: CustomerInput) {
  const c = customerInput.parse(input);
  return db.customer.update({ where: { id }, data: customerData(c) });
}

/** Suche nach Name, Ort, E-Mail oder Kundennummer */
export async function searchCustomers(q: string, take = 20) {
  const s = q.trim();
  const n = /^\d{3,9}$/.test(s) ? Number(s) : null;
  return db.customer.findMany({
    where: {
      archived: false,
      ...(s
        ? {
            OR: [
              ...s.split(/\s+/).filter(Boolean).map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
              { email: { contains: s, mode: "insensitive" } },
              { city: { contains: s, mode: "insensitive" } },
              { contactName: { contains: s, mode: "insensitive" } },
              ...(n ? [{ number: n }] : []),
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take,
  });
}

export const customerLine = (c: { name: string; number: number | null; street: string | null; zip: string | null; city: string | null; email: string | null; phone: string | null; id: string }) =>
  `${c.name}${c.number ? ` (Kd.-Nr. ${c.number})` : ""}${c.street || c.city ? ` · ${[c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""} · id ${c.id}`;

// ---------- Artikel ----------

export const articleInput = z.object({
  number: t(40),
  name: z.string().trim().min(1, "Bezeichnung fehlt.").max(300),
  description: t(4000),
  unit: z.string().trim().min(1).max(30).default("Stk"),
  priceNet: z.number().min(-1_000_000).max(10_000_000),
  taxRate: z.union([z.literal(19), z.literal(7), z.literal(0)]).default(19),
  kind: z.enum(["LEISTUNG", "MATERIAL"]).default("LEISTUNG"),
});
export type ArticleInput = z.infer<typeof articleInput>;

export async function searchArticles(q: string, take = 30) {
  const words = q.trim().split(/\s+/).filter(Boolean);
  return db.article.findMany({
    where: { archived: false, AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" as const } }, { number: { contains: w, mode: "insensitive" as const } }, { description: { contains: w, mode: "insensitive" as const } }] })) },
    orderBy: { name: "asc" },
    take,
  });
}
