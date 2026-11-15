import "server-only";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { storeFile } from "@/lib/files";
import { daysLeft, expiryState, EXPIRY_LABEL, WARN_DAYS } from "@/lib/nachunternehmer-shared";
import { CONTRACT_TYPE_LABEL, dueOf, EMP_DOC_LABEL, EMP_SENSITIVE, isSensitive, type ContractType, type EmpDocKind } from "@/lib/personal-shared";

// Digitale Personalakte: Stammdaten (EmployeeProfile) und Dokumente mit Ablaufdatum (EmployeeDoc).
// Alles Sensible nur für Administratoren. Mitarbeiter sehen nur ihre eigenen, nicht sensiblen Einträge
// (Führerschein, Qualifikationen, Unterweisungen, Ersthelfer) – ohne Datei. Ablaufwarnung über jobs.ts.

export class PersonalError extends Error {}
type Actor = { id: string; name: string; role: string };
const adminOnly = (a: Actor) => {
  if (a.role !== "ADMIN") throw new PersonalError("Die Personalakte dürfen nur Administratoren bearbeiten.");
};

export type ProfileInput = {
  jobTitle?: string | null; birthDate?: Date | null; street?: string | null; zip?: string | null; city?: string | null; privatePhone?: string | null; privateEmail?: string | null;
  emergencyContact?: string | null; entryDate?: Date | null; exitDate?: Date | null; contractType?: ContractType | null; contractUntil?: Date | null; weeklyHours?: number | null; wage?: string | null; notes?: string | null;
};

export async function saveProfile(userId: string, i: ProfileInput, actor: Actor) {
  adminOnly(actor);
  return db.employeeProfile.upsert({ where: { userId }, create: { userId, ...i, updatedBy: actor.name }, update: { ...i, updatedBy: actor.name } });
}

export async function addEmployeeDoc(userId: string, i: { kind: EmpDocKind; title: string; number?: string | null; issuedAt?: Date | null; validUntil?: Date | null; nextCheck?: Date | null; note?: string | null; file?: { name: string; mime: string; data: Buffer } | null }, actor: Actor) {
  adminOnly(actor);
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!u) throw new PersonalError("Mitarbeiter nicht gefunden.");
  const f = i.file ? await storeFile({ ...i.file, name: `${u.name} – ${i.title} – ${i.file.name}`, kind: "personal", uploadedBy: actor.name }) : null;
  return db.employeeDoc.create({ data: { userId, kind: i.kind, title: i.title, number: i.number || null, issuedAt: i.issuedAt ?? null, validUntil: i.validUntil ?? null, nextCheck: i.nextCheck ?? null, note: i.note || null, fileId: f?.id ?? null, createdBy: actor.name } });
}

/** Kontrolle erledigt (z. B. Führerscheinkontrolle): nächste Kontrolle in `months` Monaten */
export async function markChecked(docId: string, months: number, actor: Actor) {
  adminOnly(actor);
  const next = new Date();
  next.setMonth(next.getMonth() + months);
  const d = await db.employeeDoc.findUniqueOrThrow({ where: { id: docId } });
  return db.employeeDoc.update({ where: { id: docId }, data: { nextCheck: next, note: [d.note, `Kontrolle ${formatDate(new Date())} (${actor.name})`].filter(Boolean).join(" · ").slice(-1000) } });
}

export async function deleteEmployeeDoc(docId: string, actor: Actor) {
  adminOnly(actor);
  const d = await db.employeeDoc.delete({ where: { id: docId } });
  if (d.fileId) await db.storedFile.deleteMany({ where: { id: d.fileId, kind: "personal" } });
  return d;
}

/** Dokumente, die in `days` Tagen ablaufen bzw. deren Kontrolle fällig wird (ohne ausgeschiedene Mitarbeiter) */
export async function expiringEmployeeDocs(days = WARN_DAYS, opts: { userId?: string; sensitive?: boolean } = {}) {
  const until = new Date(Date.now() + days * 86400_000);
  const docs = await db.employeeDoc.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.sensitive === false ? { kind: { notIn: [...EMP_SENSITIVE] } } : {}),
      OR: [{ validUntil: { lte: until } }, { nextCheck: { lte: until } }],
      user: { OR: [{ employeeProfile: null }, { employeeProfile: { OR: [{ exitDate: null }, { exitDate: { gt: new Date() } }] } }] },
    },
    include: { user: { select: { id: true, name: true } } },
  });
  // Nicht melden, wenn es einen neueren Eintrag mit gleicher Art und Bezeichnung gibt (z. B. erneuerte Schweißerprüfung)
  const all = await db.employeeDoc.findMany({ where: { userId: { in: [...new Set(docs.map((d) => d.userId))] } }, select: { userId: true, kind: true, title: true, validUntil: true } });
  return docs
    .filter((d) => !all.some((o) => o.userId === d.userId && o.kind === d.kind && o.title === d.title && o.validUntil && d.validUntil && o.validUntil > d.validUntil))
    .map((d) => ({ ...d, due: dueOf(d)!, check: Boolean(d.nextCheck && (!d.validUntil || d.nextCheck <= d.validUntil)) }))
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}

/** Wer hat eine Qualifikation (Suche in Bezeichnung, nur gültige) – für „Wer hat Staplerschein?“ */
export async function whoHas(q: string) {
  const docs = await db.employeeDoc.findMany({
    where: { kind: { notIn: [...EMP_SENSITIVE] }, OR: [{ title: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }] },
    include: { user: { select: { name: true } } },
    orderBy: { validUntil: "desc" },
  });
  return docs.map((d) => ({ ...d, state: expiryState(d.validUntil) }));
}

export const empDocLine = (d: { kind: string; title: string; validUntil: Date | null; nextCheck: Date | null; user?: { name: string } | null }) => {
  const due = dueOf(d);
  const st = expiryState(due);
  return `- ${d.user ? `${d.user.name}: ` : ""}${d.title} (${EMP_DOC_LABEL[d.kind as EmpDocKind] ?? d.kind})${d.validUntil ? ` · gültig bis ${formatDate(d.validUntil)}` : ""}${d.nextCheck ? ` · Kontrolle fällig ${formatDate(d.nextCheck)}` : ""}${due ? ` · ${st === "abgelaufen" ? "ABGELAUFEN" : st === "bald" ? `noch ${daysLeft(due)} Tage` : EXPIRY_LABEL[st]}` : ""}`;
};

/** Akte als Text (für Jarvis); sensible Teile nur mit full = true */
export async function personalText(userId: string, full: boolean) {
  const u = await db.user.findUnique({ where: { id: userId }, include: { employeeProfile: true, employeeDocs: { orderBy: [{ kind: "asc" }, { validUntil: "desc" }] } } });
  if (!u) throw new PersonalError("Mitarbeiter nicht gefunden.");
  const p = u.employeeProfile;
  const docs = u.employeeDocs.filter((d) => full || !isSensitive(d.kind));
  return [
    `**${u.name}**${p?.jobTitle ? ` – ${p.jobTitle}` : ""}`,
    full && p ? [p.entryDate && `Eintritt ${formatDate(p.entryDate)}`, p.contractType && `Vertrag ${CONTRACT_TYPE_LABEL[p.contractType as ContractType] ?? p.contractType}${p.contractUntil ? ` bis ${formatDate(p.contractUntil)}` : ""}`, p.weeklyHours && `${p.weeklyHours} Std./Woche`, p.exitDate && `Austritt ${formatDate(p.exitDate)}`].filter(Boolean).join(" · ") : null,
    full && p?.emergencyContact ? `Notfallkontakt: ${p.emergencyContact}` : null,
    docs.length ? "Dokumente:" : "Keine Einträge.",
    ...docs.map((d) => empDocLine(d)),
    full ? `[Personalakte](/personal/${u.id})` : "[Meine Qualifikationen](/personal)",
  ].filter(Boolean).join("\n");
}
