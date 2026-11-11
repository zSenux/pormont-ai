import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { formatDate } from "@/lib/berlin";
import { sendMail, MailError } from "@/lib/mail/client";
import { mailConfigured } from "@/lib/mail/config";

// Lieferanten und Preisanfragen (Kostenvoranschläge). Die Mail an den Lieferanten geht erst raus,
// wenn ein Mensch auf „Senden“ tippt (Seite) bzw. die Freigabe-Karte „preisanfrage_senden“ freigibt (Jarvis).
// Gesendet wird immer der Text aus der Datenbank – nie direkt Modell-Text.

export const SUPPLIER_KINDS = ["STAHL", "GROSSHANDEL", "VERZINKEREI", "SCHLOSSERTEILE", "SONSTIGE"] as const;
export type SupplierKindKey = (typeof SUPPLIER_KINDS)[number];

export const KIND_LABEL: Record<SupplierKindKey, string> = {
  STAHL: "Stahl / Eisenhandel",
  GROSSHANDEL: "Großeisenhandel",
  VERZINKEREI: "Verzinkerei",
  SCHLOSSERTEILE: "Schlosserteile",
  SONSTIGE: "Sonstiges",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  ENTWURF: "Entwurf",
  WIRD_GESENDET: "Wird gesendet",
  GESENDET: "Angefragt",
  ANGEBOT: "Angebot da",
  BESTELLT: "Bestellt",
  ABGESAGT: "Abgesagt",
};
export const REQUEST_STATUS_TONE: Record<string, string> = {
  ENTWURF: "border-line bg-mist text-steel",
  WIRD_GESENDET: "border-line bg-mist text-steel",
  GESENDET: "border-brand/30 bg-brand-soft text-brand",
  ANGEBOT: "border-amber-300 bg-amber-50 text-amber-800",
  BESTELLT: "border-emerald-300 bg-emerald-50 text-emerald-800",
  ABGESAGT: "border-line bg-white text-steel",
};

/** Vorschläge zum Anlegen mit einem Klick (Kontaktdaten trägt das Büro nach) */
export const SUPPLIER_SUGGESTIONS: { name: string; kind: SupplierKindKey; website?: string; notes?: string }[] = [
  { name: "Haug Eisenhandel", kind: "STAHL", notes: "Stahl-Zukauf (Träger, Rohre, Bleche, Flachstahl)." },
  { name: "thyssenkrupp Schulte", kind: "GROSSHANDEL", website: "https://www.thyssenkrupp-schulte.de", notes: "Großeisenhandel – Niederlassung und Ansprechpartner bitte eintragen." },
  { name: "Wiegel Feuerverzinken", kind: "VERZINKEREI", website: "https://wiegel.de", notes: "Feuerverzinkung – Standort Plankstadt bzw. Rheinau prüfen." },
  { name: "Schlosserteile-Lieferant", kind: "SCHLOSSERTEILE", notes: "Name bitte eintragen. Katalog mit Preisliste unter „Katalog importieren“ hochladen." },
];

export const positionSchema = z.object({
  menge: z.number().positive().max(1_000_000).nullable().optional(),
  einheit: z.string().trim().max(20).nullable().optional(),
  text: z.string().trim().min(1).max(500),
});
export type Position = z.infer<typeof positionSchema>;

const UNIT = "(stk|st|stück|stck|m|lfm|mtr|kg|t|to|m²|qm|m2|pal|pak|pck|paket|satz|tafeln?|stangen?)";
/** „12 Stk HEA 200 S235JR 6 m“ → { menge 12, einheit Stk, text … } – eine Zeile = eine Position */
export function parsePositions(raw: string): Position[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((l) => {
      const m = l.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(?:x\\s*)?${UNIT}?\\.?\\s+(.+)$`, "i"));
      if (!m) return { menge: null, einheit: null, text: l.slice(0, 500) };
      return { menge: Number(m[1].replace(",", ".")), einheit: m[2] ? m[2].replace(/^st(ck|ück)?$/i, "Stk") : null, text: m[3].slice(0, 500) };
    });
}

export const positionLine = (p: Position) => [p.menge ? p.menge.toLocaleString("de-DE") : null, p.einheit, p.text].filter(Boolean).join(" ");

const INTRO: Record<SupplierKindKey, string> = {
  STAHL: "bitte senden Sie uns Ihr Angebot mit Preis und Lieferzeit für folgendes Material:",
  GROSSHANDEL: "bitte senden Sie uns Ihr Angebot mit Preis und Lieferzeit für folgendes Material:",
  VERZINKEREI: "bitte nennen Sie uns Preis und Termin für das Feuerverzinken folgender Teile:",
  SCHLOSSERTEILE: "bitte senden Sie uns ein Angebot über folgende Artikel:",
  SONSTIGE: "bitte senden Sie uns ein Angebot über folgende Positionen:",
};
const OUTRO: Record<SupplierKindKey, string | null> = {
  STAHL: "Bitte Preise netto inkl. eventueller Zuschläge (Legierung/Schrott), Zuschnitt und Fracht getrennt ausweisen.",
  GROSSHANDEL: "Bitte Preise netto inkl. eventueller Zuschläge (Legierung/Schrott), Zuschnitt und Fracht getrennt ausweisen.",
  VERZINKEREI: "Bitte Preis je kg bzw. pauschal sowie den frühestmöglichen Termin angeben.",
  SCHLOSSERTEILE: "Bitte Nettopreise und Lieferzeit angeben.",
  SONSTIGE: null,
};

/** Text der Anfrage-Mail (Sie-Form, mit Signatur) */
export function requestMail(o: { supplier: { name: string; kind: SupplierKindKey; contactName: string | null; customerNo: string | null }; positions: Position[]; projectName?: string | null; dueAt?: Date | null; delivery?: string | null; note?: string | null; userName: string }) {
  const s = o.supplier;
  const greet = s.contactName ? `Guten Tag ${s.contactName},` : "Sehr geehrte Damen und Herren,";
  const lines = o.positions.map((p, i) => `${i + 1}. ${positionLine(p)}`).join("\n");
  const extra = [
    o.projectName ? `Bauvorhaben: ${o.projectName}` : null,
    o.delivery ? `Lieferung: ${o.delivery}` : null,
    s.customerNo ? `Unsere Kundennummer: ${s.customerNo}` : null,
  ].filter(Boolean);
  const text = [
    greet,
    "",
    INTRO[s.kind],
    "",
    lines,
    extra.length ? `\n${extra.join("\n")}` : null,
    o.note ? `\n${o.note}` : null,
    OUTRO[s.kind] ? `\n${OUTRO[s.kind]}` : null,
    o.dueAt ? `Wir freuen uns über Ihre Rückmeldung bis ${formatDate(o.dueAt)}.` : "Wir freuen uns über Ihre baldige Rückmeldung.",
    "",
    "Viele Grüße",
    o.userName,
    COMPANY.name,
    `${COMPANY.street} · ${COMPANY.zip} ${COMPANY.city}`,
    `Tel. ${COMPANY.phone} · ${COMPANY.email}`,
  ]
    .filter((x) => x !== null)
    .join("\n");
  const first = o.positions[0]?.text ?? "Material";
  const subject = `${s.kind === "VERZINKEREI" ? "Anfrage Feuerverzinkung" : "Preisanfrage"}${o.projectName ? ` – ${o.projectName}` : ""} – ${first}${o.positions.length > 1 ? " u. a." : ""}`.slice(0, 160);
  return { subject, text };
}

export class SupplierError extends Error {}

/** Anfrage als Entwurf speichern (Text aus Vorlage, Positionen geprüft) */
export async function createRequest(o: { supplierId: string; positions: Position[]; projectId?: string | null; dueAt?: Date | null; delivery?: string | null; note?: string | null; user: { id: string; name: string } }) {
  const supplier = await db.supplier.findUnique({ where: { id: o.supplierId } });
  if (!supplier) throw new SupplierError("Lieferant nicht gefunden.");
  const positions = z.array(positionSchema).min(1, "Mindestens eine Position.").max(60).parse(o.positions);
  const project = o.projectId ? await db.project.findUnique({ where: { id: o.projectId }, select: { id: true, name: true } }) : null;
  const { subject, text } = requestMail({ supplier, positions, projectName: project?.name, dueAt: o.dueAt, delivery: o.delivery, note: o.note, userName: o.user.name });
  return db.supplierRequest.create({
    data: { supplierId: supplier.id, projectId: project?.id ?? null, positions, subject, text, dueAt: o.dueAt ?? null, createdById: o.user.id, createdBy: o.user.name },
    include: { supplier: true },
  });
}

/** Anfrage senden – nur nach menschlichem Klick/Freigabe aufrufen. Atomar: ENTWURF → WIRD_GESENDET → GESENDET. */
export async function sendRequest(id: string) {
  if (!mailConfigured()) throw new SupplierError("Das E-Mail-Postfach ist noch nicht verbunden (Einstellungen → Verbindungen).");
  const r = await db.supplierRequest.findUnique({ where: { id }, include: { supplier: true } });
  if (!r) throw new SupplierError("Anfrage nicht gefunden.");
  const to = r.supplier.email;
  if (!to) throw new SupplierError(`Für ${r.supplier.name} ist keine E-Mail-Adresse hinterlegt.`);
  const claim = await db.supplierRequest.updateMany({ where: { id, status: "ENTWURF" }, data: { status: "WIRD_GESENDET", error: null } });
  if (!claim.count) throw new SupplierError("Diese Anfrage wurde schon gesendet.");
  try {
    await sendMail({ to, subject: r.subject, text: r.text });
  } catch (e) {
    const msg = e instanceof MailError ? e.message : "Senden fehlgeschlagen.";
    await db.supplierRequest.update({ where: { id }, data: { status: "ENTWURF", error: msg } });
    throw new SupplierError(msg);
  }
  await db.supplierRequest.update({ where: { id }, data: { status: "GESENDET", sentAt: new Date(), sentTo: to } });
  return { to, supplier: r.supplier.name };
}
