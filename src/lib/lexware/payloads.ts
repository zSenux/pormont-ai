import { z } from "zod";
import { berlinDateTime, todayYmd, addDaysYmd } from "@/lib/berlin";

// Eingaben für schreibende Lexware-Aktionen (von Jarvis vorgeschlagen, vom Team freigegeben)

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");

export const contactInput = z
  .object({
    art: z.enum(["firma", "person"]),
    firma: z.string().trim().max(250).optional(),
    anrede: z.string().trim().max(25).optional(),
    vorname: z.string().trim().max(100).optional(),
    nachname: z.string().trim().max(100).optional(),
    email: z.email().optional(),
    telefon: z.string().trim().max(40).optional(),
    strasse: z.string().trim().max(100).optional(),
    plz: z.string().trim().max(10).optional(),
    ort: z.string().trim().max(100).optional(),
    land: z.string().trim().length(2).default("DE"),
    notiz: z.string().trim().max(1000).optional(),
  })
  .refine((v) => (v.art === "firma" ? Boolean(v.firma) : Boolean(v.nachname)), { message: "Firma braucht einen Firmennamen, Person einen Nachnamen." });
export type ContactInput = z.infer<typeof contactInput>;

export const lineInput = z.object({
  name: z.string().trim().min(1).max(255),
  beschreibung: z.string().trim().max(2000).optional(),
  menge: z.number().positive().max(1_000_000),
  einheit: z.string().trim().min(1).max(30).default("Stück"),
  nettoPreis: z.number().min(-1_000_000).max(10_000_000),
  ustSatz: z.union([z.literal(0), z.literal(7), z.literal(19)]).default(19),
});

export const voucherInput = z
  .object({
    kundeId: z.uuid().optional(),
    kundeName: z.string().trim().max(250).optional(),
    strasse: z.string().trim().max(100).optional(),
    plz: z.string().trim().max(10).optional(),
    ort: z.string().trim().max(100).optional(),
    land: z.string().trim().length(2).default("DE"),
    titel: z.string().trim().max(25).optional(),
    einleitung: z.string().trim().max(2000).optional(),
    bemerkung: z.string().trim().max(2000).optional(),
    datum: ymd.optional(),
    leistungsdatum: ymd.optional(),
    gueltigBis: ymd.optional(),
    positionen: z.array(lineInput).min(1).max(100),
    festschreiben: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.kundeId || v.kundeName), { message: "Kunde fehlt (Lexware-Kontakt-ID oder Name + Anschrift)." });
export type VoucherInput = z.infer<typeof voucherInput>;

/** Lexware erwartet Datum mit Uhrzeit und Zeitzone, z. B. 2026-11-11T00:00:00.000+01:00 */
export function lexDate(d: string) {
  const utc = berlinDateTime(d, "00:00");
  const offsetMin = Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - utc.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const a = Math.abs(offsetMin);
  return `${d}T00:00:00.000${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export function contactBody(c: ContactInput) {
  const addr = c.strasse || c.plz || c.ort ? { billing: [{ street: c.strasse, zip: c.plz, city: c.ort, countryCode: c.land }] } : undefined;
  return {
    version: 0,
    roles: { customer: {} },
    ...(c.art === "firma"
      ? {
          company: {
            name: c.firma,
            ...(c.nachname ? { contactPersons: [{ salutation: c.anrede, firstName: c.vorname, lastName: c.nachname, primary: true, emailAddress: c.email, phoneNumber: c.telefon }] } : {}),
          },
        }
      : { person: { salutation: c.anrede, firstName: c.vorname, lastName: c.nachname } }),
    ...(addr ? { addresses: addr } : {}),
    ...(c.email ? { emailAddresses: { business: [c.email] } } : {}),
    ...(c.telefon ? { phoneNumbers: { business: [c.telefon] } } : {}),
    ...(c.notiz ? { note: c.notiz } : {}),
  };
}

function common(v: VoucherInput) {
  return {
    voucherDate: lexDate(v.datum ?? todayYmd()),
    address: v.kundeId ? { contactId: v.kundeId } : { name: v.kundeName, street: v.strasse, zip: v.plz, city: v.ort, countryCode: v.land },
    lineItems: v.positionen.map((p) => ({
      type: "custom",
      name: p.name,
      ...(p.beschreibung ? { description: p.beschreibung } : {}),
      quantity: p.menge,
      unitName: p.einheit,
      unitPrice: { currency: "EUR", netAmount: Math.round(p.nettoPreis * 100) / 100, taxRatePercentage: p.ustSatz },
    })),
    totalPrice: { currency: "EUR" },
    taxConditions: { taxType: "net" },
    ...(v.titel ? { title: v.titel } : {}),
    ...(v.einleitung ? { introduction: v.einleitung } : {}),
    ...(v.bemerkung ? { remark: v.bemerkung } : {}),
  };
}

export function invoiceBody(v: VoucherInput) {
  return { ...common(v), shippingConditions: { shippingType: "service", shippingDate: lexDate(v.leistungsdatum ?? v.datum ?? todayYmd()) } };
}

export function quotationBody(v: VoucherInput) {
  return { ...common(v), expirationDate: lexDate(v.gueltigBis ?? addDaysYmd(v.datum ?? todayYmd(), 30)) };
}

/** Summen für die Freigabe-Karte */
export function totals(v: VoucherInput) {
  let net = 0;
  let tax = 0;
  for (const p of v.positionen) {
    const n = p.menge * p.nettoPreis;
    net += n;
    tax += (n * p.ustSatz) / 100;
  }
  return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100, gross: Math.round((net + tax) * 100) / 100 };
}
