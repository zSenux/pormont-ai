import "server-only";
import { db } from "@/lib/db";
import { berlinParts, formatDate } from "@/lib/berlin";
import { nextSequence } from "@/lib/buchhaltung/docs";
import { storeFile } from "@/lib/files";
import { ampelOf, AMPEL_LABEL, BAGATELL_EUR, BAUABZUG_PCT, daysLeft, exemptionValid, expiryState, EXPIRY_LABEL, NU_CONTRACT_LABEL, NU_DOC_LABEL, NU_DOC_SHORT, WARN_DAYS, type NuContractStatus, type NuDocKind } from "@/lib/nachunternehmer-shared";

// Nachunternehmer (Subunternehmer): Stammdaten, Nachweise mit Ablaufdatum (§ 48b-Freistellung, Unbedenklichkeit …)
// und Verträge NU-<Jahr>-0001 je Projekt. Ablaufwarnung per Push (jobs.ts → expiryWarnings).
// Bauabzugsteuer: ohne gültige Freistellung muss ProMont 15 % einbehalten – Jarvis/Seite zeigen nur den Hinweis.

export class NuError extends Error {}
type Actor = { name: string };

export type NuInput = { name: string; trade?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; street?: string | null; zip?: string | null; city?: string | null; taxNumber?: string | null; notes?: string | null };

export async function createSubcontractor(i: NuInput, actor: Actor) {
  const dup = await db.subcontractor.findFirst({ where: { name: { equals: i.name.trim(), mode: "insensitive" } } });
  if (dup) throw new NuError(`„${dup.name}“ gibt es schon.`);
  return db.subcontractor.create({ data: { ...i, name: i.name.trim(), createdBy: actor.name } });
}

export async function updateSubcontractor(id: string, i: NuInput & { active?: boolean }) {
  return db.subcontractor.update({ where: { id }, data: i });
}

export async function addNuDoc(subcontractorId: string, i: { kind: NuDocKind; title?: string | null; number?: string | null; validFrom?: Date | null; validUntil?: Date | null; note?: string | null; file?: { name: string; mime: string; data: Buffer } | null }, actor: Actor) {
  const sub = await db.subcontractor.findUnique({ where: { id: subcontractorId }, select: { id: true, name: true } });
  if (!sub) throw new NuError("Nachunternehmer nicht gefunden.");
  if (i.validFrom && i.validUntil && i.validUntil < i.validFrom) throw new NuError("„Gültig bis“ liegt vor „Gültig ab“.");
  const f = i.file ? await storeFile({ ...i.file, name: `${NU_DOC_SHORT[i.kind]} ${sub.name} – ${i.file.name}`, kind: "nachunternehmer", uploadedBy: actor.name }) : null;
  return db.subcontractorDoc.create({ data: { subcontractorId, kind: i.kind, title: i.title || null, number: i.number || null, validFrom: i.validFrom ?? null, validUntil: i.validUntil ?? null, note: i.note || null, fileId: f?.id ?? null, createdBy: actor.name } });
}

export async function deleteNuDoc(id: string) {
  const d = await db.subcontractorDoc.delete({ where: { id } });
  if (d.fileId) await db.storedFile.deleteMany({ where: { id: d.fileId, kind: "nachunternehmer" } });
  return d;
}

export async function createContract(i: { subcontractorId: string; projectId?: string | null; title: string; scope?: string | null; amountNet?: number | null; status?: NuContractStatus; startDate?: Date | null; endDate?: Date | null; retentionPct?: number | null }, actor: Actor) {
  const year = berlinParts().y;
  return db.$transaction(async (tx) => {
    const n = await nextSequence(tx, `NACHUNTERNEHMER-${year}`);
    return tx.subcontractorContract.create({ data: { ...i, status: i.status ?? "BEAUFTRAGT", number: `NU-${year}-${String(n).padStart(4, "0")}`, createdBy: actor.name } });
  });
}

export async function setContractStatus(id: string, status: NuContractStatus) {
  return db.subcontractorContract.update({ where: { id }, data: { status } });
}

/** Alle Nachunternehmer mit Ampel */
export async function listSubcontractors(opts: { q?: string; all?: boolean } = {}) {
  const rows = await db.subcontractor.findMany({
    where: { ...(opts.all ? {} : { active: true }), ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { trade: { contains: opts.q, mode: "insensitive" } }] } : {}) },
    orderBy: { name: "asc" },
    include: { docs: true, contracts: { where: { status: { notIn: ["STORNIERT"] } }, select: { id: true, status: true, amountNet: true, startDate: true } } },
  });
  return rows.map((s) => ({ ...s, check: ampelOf(s.docs), exempt: exemptionValid(s.docs) }));
}

/** Nachweise (Nachunternehmer), die in `days` Tagen ablaufen oder abgelaufen sind */
export async function expiringNuDocs(days = WARN_DAYS) {
  const until = new Date(Date.now() + days * 86400_000);
  const docs = await db.subcontractorDoc.findMany({ where: { validUntil: { lte: until }, subcontractor: { active: true } }, orderBy: { validUntil: "asc" }, include: { subcontractor: { select: { id: true, name: true, docs: { select: { kind: true, validUntil: true } } } } } });
  // Nur melden, wenn es keinen neueren Nachweis derselben Art gibt
  return docs.filter((d) => !d.subcontractor.docs.some((o) => o.kind === d.kind && o.validUntil && d.validUntil && o.validUntil > d.validUntil));
}

/** Bauabzugsteuer-Hinweis für eine Zahlung an einen Nachunternehmer */
export async function bauabzugCheck(subcontractorId: string, amountGross: number | null, at = new Date()) {
  const s = await db.subcontractor.findUnique({ where: { id: subcontractorId }, include: { docs: true, contracts: { where: { status: { not: "STORNIERT" } } } } });
  if (!s) throw new NuError("Nachunternehmer nicht gefunden.");
  const exempt = exemptionValid(s.docs, at);
  const y = berlinParts(at).y;
  const yearGross = s.contracts.filter((c) => c.startDate && berlinParts(c.startDate).y === y).reduce((t, c) => t + (c.amountNet ?? 0) * 1.19, 0);
  const total = yearGross + (amountGross ?? 0);
  const deduct = !exempt && total >= BAGATELL_EUR;
  return { sub: s, exempt, yearGross, deduct, deduction: deduct && amountGross ? Math.round(amountGross * BAUABZUG_PCT) / 100 : null };
}

/** Kurztext für Jarvis */
export function nuLine(s: Awaited<ReturnType<typeof listSubcontractors>>[number]) {
  const c = s.check;
  const issues = [...c.missing.map((k) => `${NU_DOC_SHORT[k]} fehlt`), ...c.expired.map((k) => `${NU_DOC_SHORT[k]} abgelaufen`), ...c.soon.map((k) => `${NU_DOC_SHORT[k]} läuft bald ab`)];
  return `- ${s.name}${s.trade ? ` (${s.trade})` : ""} · ${AMPEL_LABEL[c.ampel]}${issues.length ? `: ${issues.join(", ")}` : ""} · § 48b ${s.exempt ? "gültig" : "NICHT gültig"} · ${s.contracts.length} Verträge · id ${s.id} · [öffnen](/nachunternehmer/${s.id})`;
}

export async function nuDetailText(id: string) {
  const s = await db.subcontractor.findUnique({ where: { id }, include: { docs: { orderBy: { validUntil: "desc" } }, contracts: { orderBy: { createdAt: "desc" }, include: { project: { select: { name: true } } } } } });
  if (!s) throw new NuError("Nachunternehmer nicht gefunden.");
  const c = ampelOf(s.docs);
  return [
    `**${s.name}**${s.trade ? ` – ${s.trade}` : ""} · ${AMPEL_LABEL[c.ampel]} · § 48b ${exemptionValid(s.docs) ? "gültig" : "NICHT gültig – ohne gültige Freistellung 15 % Bauabzugsteuer einbehalten (ab 5.000 € im Jahr)"}`,
    [s.contactName, s.phone, s.email, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || null,
    "Nachweise:",
    ...(s.docs.length ? s.docs.map((d) => `- ${NU_DOC_LABEL[d.kind as NuDocKind] ?? d.kind}${d.number ? ` Nr. ${d.number}` : ""}: ${d.validUntil ? `bis ${formatDate(d.validUntil)}` : "ohne Datum"} (${EXPIRY_LABEL[expiryState(d.validUntil)]})`) : ["- keine"]),
    "Verträge:",
    ...(s.contracts.length ? s.contracts.map((k) => `- ${k.number} · ${k.title}${k.project ? ` · ${k.project.name}` : ""} · ${NU_CONTRACT_LABEL[k.status as NuContractStatus]}${k.amountNet ? ` · ${k.amountNet.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} netto` : ""}`) : ["- keine"]),
    `[öffnen](/nachunternehmer/${s.id})`,
  ].filter(Boolean).join("\n");
}

export const expiryLine = (d: { kind: string; validUntil: Date | null; subcontractor: { name: string; id: string } }) =>
  `- ${d.subcontractor.name}: ${NU_DOC_LABEL[d.kind as NuDocKind] ?? d.kind} ${d.validUntil ? (daysLeft(d.validUntil) < 0 ? `abgelaufen am ${formatDate(d.validUntil)}` : `läuft ab am ${formatDate(d.validUntil)} (noch ${daysLeft(d.validUntil)} Tage)`) : ""} · [öffnen](/nachunternehmer/${d.subcontractor.id})`;
