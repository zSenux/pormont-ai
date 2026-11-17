"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/rights";
import { mailInput } from "@/lib/mail/input";
import { MAIL_ID } from "@/lib/mail/types";
import { personSchema, signatureSchema } from "@/lib/mail/signature-shared";

// Mails direkt in der Mail-Seite schreiben, beantworten und weiterleiten.
// Gesendet wird nur per Klick eines angemeldeten Menschen auf „Senden“ (Jarvis braucht weiter die Freigabe-Karte).

type Result = { ok?: string; error?: string; sent?: boolean } | undefined;

const MAX_UPLOAD = 9 * 1024 * 1024; // Server-Actions nehmen höchstens 10 MB an
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const optId = z.string().regex(MAIL_ID).optional();

export async function sendMailAction(_: Result, fd: FormData): Promise<Result> {
  await requireArea("mail");
  const draft = str(fd.get("modus")) === "entwurf";
  const parsed = mailInput.safeParse({
    an: str(fd.get("an")),
    cc: str(fd.get("cc")).trim() || undefined,
    betreff: str(fd.get("betreff")),
    text: str(fd.get("text")),
  });
  if (!parsed.success) {
    const f = parsed.error.issues[0];
    const field = ({ an: "An", cc: "CC", betreff: "Betreff", text: "Text" } as Record<string, string>)[String(f?.path[0])] ?? "Eingabe";
    return { error: `${field}: ${f?.code === "too_small" ? "bitte ausfüllen." : (f?.message ?? "bitte prüfen.")}` };
  }
  const reply = optId.safeParse(str(fd.get("antwort")) || undefined);
  const forward = optId.safeParse(str(fd.get("weiter")) || undefined);
  if (!reply.success || !forward.success) return { error: "Ungültige Mail-Kennung." };

  // eigene Anhänge aus dem Formular
  const files = fd.getAll("anhang").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_UPLOAD) return { error: "Die Anhänge sind zusammen größer als 9 MB." };

  const { readMail, mailAttachment, sendMail, saveDraft, MailError } = await import("@/lib/mail/client");
  try {
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    for (const f of files.slice(0, 10)) attachments.push({ filename: f.name.slice(0, 200) || "anhang", content: Buffer.from(await f.arrayBuffer()), contentType: f.type || "application/octet-stream" });

    let inReplyTo: string | null = null;
    let references: string[] | undefined;
    if (reply.data) {
      const o = await readMail(reply.data);
      inReplyTo = o.messageId;
      references = [...o.references, ...(o.messageId ? [o.messageId] : [])].slice(-20);
    }
    // Weiterleiten: Anhänge der Original-Mail mitschicken, wenn angehakt
    if (forward.data && fd.get("originalAnhaenge") === "1") {
      const o = await readMail(forward.data);
      let size = total;
      for (let i = 0; i < Math.min(o.attachments.length, 15); i++) {
        const a = await mailAttachment(forward.data, i);
        size += a.content.length;
        if (size > 25 * 1024 * 1024) return { error: "Die Anhänge der Original-Mail sind zusammen größer als 25 MB." };
        attachments.push(a);
      }
    }

    const m = parsed.data;
    const out = { to: m.an, cc: m.cc, subject: m.betreff, text: m.text, inReplyTo, references, attachments, signature: fd.get("signatur") === "1" };
    if (draft) {
      const r = await saveDraft(out);
      return { ok: `Entwurf im Ordner „${r.folder}“ gespeichert.` };
    }
    await sendMail(out);
    revalidatePath("/mail");
    return { ok: `Mail an ${m.an} gesendet.`, sent: true };
  } catch (e) {
    return { error: e instanceof MailError ? e.message : "Senden hat nicht geklappt. Bitte später nochmal versuchen." };
  }
}

// ---------- Signatur ----------

const companySigForm = signatureSchema.omit({ users: true });

export async function saveSignatureAction(input: { company?: unknown; person: unknown }): Promise<Result> {
  const u = await requireArea("mail");
  const person = personSchema.safeParse(input.person);
  if (!person.success) return { error: "Bitte die eigenen Angaben prüfen (E-Mail-Adresse?)." };
  const { saveCompanySignature, savePersonalSignature } = await import("@/lib/mail/signature");
  if (input.company !== undefined) {
    if (u.role !== "ADMIN") return { error: "Den Firmenteil der Signatur ändert nur ein Administrator." };
    const c = companySigForm.safeParse(input.company);
    if (!c.success) return { error: "Bitte die Einstellungen prüfen (Farbe als #RRGGBB)." };
    await saveCompanySignature(c.data);
  }
  await savePersonalSignature(u.id, person.data);
  revalidatePath("/mail/signatur");
  return { ok: "Signatur gespeichert." };
}

/** Probe-Mail mit der gespeicherten Signatur an die eigene Adresse */
export async function signatureTestAction(): Promise<Result> {
  const u = await requireArea("mail");
  if (u.email.endsWith(".invalid")) return { error: "Für dein Konto ist keine echte E-Mail-Adresse hinterlegt." };
  const { sendMail, MailError } = await import("@/lib/mail/client");
  try {
    await sendMail({ to: u.email, subject: "Probe: E-Mail-Signatur aus Jarvis", text: `Hallo ${u.name.split(" ")[0]},\n\nso sieht deine Signatur beim Empfänger aus.` });
    return { ok: `Probe-Mail an ${u.email} gesendet.` };
  } catch (e) {
    return { error: e instanceof MailError ? e.message : "Senden hat nicht geklappt." };
  }
}
