import "server-only";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/berlin";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { guessMime, storeFile } from "@/lib/files";
import { daysLeft, expiryState, EXPIRY_LABEL, WARN_DAYS } from "@/lib/nachunternehmer-shared";
import { CONTRACT_TYPE_LABEL, dueOf, EMP_DOC_LABEL, EMP_SENSITIVE, isSensitive, NO_LOGIN_HASH, Q_FIELDS, questionnaireState, type ContractType, type EmpDocKind } from "@/lib/personal-shared";

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

type Upload = { name: string; mime: string; data: Buffer };

/** Mehrere Fotos/Seiten (z. B. ein abfotografierter Arbeitsvertrag) zu einem PDF zusammenfügen – A4, Bild eingepasst */
export async function scanToPdf(files: Upload[]): Promise<Upload> {
  if (files.length === 1) return files[0];
  if (files.length > 30) throw new PersonalError("Höchstens 30 Seiten auf einmal.");
  const out = await PDFDocument.create();
  const A4 = [595.28, 841.89] as const;
  for (const f of files) {
    const mime = guessMime(f.name, f.mime);
    if (mime === "application/pdf") {
      const src = await PDFDocument.load(f.data, { ignoreEncryption: true }).catch(() => null);
      if (!src) throw new PersonalError(`„${f.name}“ lässt sich nicht lesen.`);
      for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
      continue;
    }
    if (mime !== "image/jpeg" && mime !== "image/png") throw new PersonalError(`„${f.name}“: Für mehrere Seiten bitte Fotos als JPG/PNG oder PDF.`);
    const img = mime === "image/png" ? await out.embedPng(f.data) : await out.embedJpg(f.data);
    const landscape = img.width > img.height;
    const [W, H] = landscape ? [A4[1], A4[0]] : A4;
    const scale = Math.min((W - 30) / img.width, (H - 30) / img.height);
    const page = out.addPage([W, H]);
    page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  }
  return { name: "Scan.pdf", mime: "application/pdf", data: Buffer.from(await out.save()) };
}

export async function addEmployeeDoc(userId: string, i: { kind: EmpDocKind; title: string; number?: string | null; issuedAt?: Date | null; validUntil?: Date | null; nextCheck?: Date | null; note?: string | null; file?: Upload | null; files?: Upload[] }, actor: Actor) {
  adminOnly(actor);
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!u) throw new PersonalError("Mitarbeiter nicht gefunden.");
  const uploads = i.files?.length ? i.files : i.file ? [i.file] : [];
  const one = uploads.length ? await scanToPdf(uploads) : null;
  const f = one ? await storeFile({ ...one, name: `${u.name} – ${i.title} – ${one.name}`, kind: "personal", uploadedBy: actor.name }) : null;
  return db.employeeDoc.create({ data: { userId, kind: i.kind, title: i.title, number: i.number || null, issuedAt: i.issuedAt ?? null, validUntil: i.validUntil ?? null, nextCheck: i.nextCheck ?? null, note: i.note || null, fileId: f?.id ?? null, createdBy: actor.name } });
}

/** Neuen Mitarbeiter anlegen – ohne App-Zugang (Monteure, Aushilfen). Einen Zugang gibt der Admin später unter Einstellungen → Team. */
export async function createEmployee(i: { name: string; jobTitle?: string | null; entryDate?: Date | null; contractType?: ContractType | null; funktion?: string | null }, actor: Actor) {
  adminOnly(actor);
  const email = `personal-${randomBytes(6).toString("hex")}@ohne-zugang.invalid`;
  return db.user.create({
    data: { name: i.name, email, passwordHash: NO_LOGIN_HASH, role: "MEMBER", funktion: i.funktion ?? null, employeeProfile: { create: { jobTitle: i.jobTitle ?? null, entryDate: i.entryDate ?? null, contractType: i.contractType ?? null, updatedBy: actor.name } } },
    select: { id: true },
  });
}

/** Personalfragebogen speichern (nur bekannte Felder, Texte gekürzt); Geburtsdatum/Anschrift/Notfall auch in die Stammdaten */
export async function saveQuestionnaire(userId: string, values: Record<string, string>, actor: Actor) {
  adminOnly(actor);
  const q: Record<string, string> = {};
  for (const f of Q_FIELDS) {
    const v = (values[f.key] ?? "").trim().slice(0, 200);
    if (!v) continue;
    if (f.type === "select" && f.options && !f.options.includes(v)) continue;
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    q[f.key] = v;
  }
  if (q.iban) q.iban = q.iban.replace(/\s+/g, "").toUpperCase();
  if (q.steuerId && !/^\d{11}$/.test(q.steuerId.replace(/\s+/g, ""))) throw new PersonalError("Die Steuer-ID hat 11 Ziffern.");
  if (q.steuerId) q.steuerId = q.steuerId.replace(/\s+/g, "");
  const extra = { ...(q.notfall ? { emergencyContact: q.notfall } : {}), ...(q.telefon ? { privatePhone: q.telefon } : {}), ...(q.email ? { privateEmail: q.email } : {}) };
  await db.employeeProfile.upsert({
    where: { userId },
    create: { userId, questionnaire: q, questionnaireAt: new Date(), updatedBy: actor.name, ...extra },
    update: { questionnaire: q, questionnaireAt: new Date(), updatedBy: actor.name, ...extra },
  });
  return questionnaireState(q);
}

export const readQuestionnaire = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string> : {});

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
