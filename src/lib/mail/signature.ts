import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { DEFAULT_SIGNATURE, hasGreeting, personSchema, signatureHtml, signatureSchema, signatureText, splitQuote, textToHtml, type SignatureConfig, type SignaturePerson } from "./signature-shared";
import type { OutgoingMail } from "./types";

// E-Mail-Signatur: Einstellungen laden/speichern und beim Senden an die Mail hängen (HTML + Text, Logo als eingebettetes Bild).

const KEY = "MAIL_SIGNATUR";
export const LOGO_CID = "promont-logo";

export async function signatureConfig(): Promise<SignatureConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  try {
    const p = signatureSchema.safeParse(row ? JSON.parse(row.value) : {});
    if (p.success) return p.data;
  } catch {}
  return DEFAULT_SIGNATURE;
}

async function store(cfg: SignatureConfig) {
  const value = JSON.stringify(signatureSchema.parse(cfg));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

/** Firmenteil (nur Admin) – die persönlichen Angaben bleiben erhalten */
export async function saveCompanySignature(input: Omit<SignatureConfig, "users">) {
  const cur = await signatureConfig();
  await store({ ...signatureSchema.parse({ ...input, users: {} }), users: cur.users });
}

/** Eigene Angaben (jeder für sich) */
export async function savePersonalSignature(userId: string, p: SignaturePerson) {
  const cur = await signatureConfig();
  await store({ ...cur, users: { ...cur.users, [userId]: personSchema.parse(p) } });
}

export const signatureCompany = () => COMPANY;

let logo: Buffer | null = null;
async function logoPng() {
  logo ??= await readFile(path.join(process.cwd(), "src/lib/mail/assets/logo-mail.png"));
  return logo;
}

/** Wer sendet? Angemeldeter Nutzer – im Hintergrund (Jobs) gibt es keinen, dann nur der Firmenteil */
async function sender(cfg: SignatureConfig): Promise<{ name: string } & SignaturePerson> {
  try {
    const { currentUser } = await import("@/lib/auth/user");
    const u = await currentUser();
    if (u) return { name: u.name, ...(cfg.users[u.id] ?? personSchema.parse({})) };
  } catch {}
  return { name: COMPANY.name, ...personSchema.parse({}) };
}

/** Vorlagen (Belege, Mahnungen, Preisanfragen) enden mit Gruß + Name + Firmenzeilen – das ersetzt jetzt die Signatur */
function stripOldFooter(body: string, name: string) {
  const lines = body.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 7); i--) {
    if (!/(grüße|gruß|gruss)\s*,?$/i.test(lines[i].trim())) continue;
    const rest = lines.slice(i + 1).map((l) => l.trim()).filter(Boolean);
    const footer = (l: string) => l === name || l.includes(COMPANY.name) || l.includes(COMPANY.street) || l.includes(COMPANY.phone) || l.includes(COMPANY.email);
    if (rest.length && rest.every(footer)) return lines.slice(0, i + 1).join("\n");
    break;
  }
  return body;
}

/**
 * Signatur anhängen. `signature`: true = persönliche Mail (Mail-Seite, Jarvis), "system" = Belege/Mahnungen/Preisanfragen,
 * false = ohne. Gibt die Mail mit HTML-Teil und eingebettetem Logo zurück.
 */
export async function withSignature(m: OutgoingMail, mailbox: string): Promise<OutgoingMail> {
  if (m.signature === false) return m;
  const cfg = await signatureConfig();
  if (!cfg.enabled || (m.signature === "system" && !cfg.forSystem)) return m;
  const p = await sender(cfg);
  const c = COMPANY;
  const [body, quote] = splitQuote(m.text.replace(/\r\n?/g, "\n").trimEnd());
  const bodyClean = stripOldFooter(body, p.name);
  const withGreeting = !hasGreeting(bodyClean);
  const html = `${textToHtml(bodyClean.trimEnd())}${signatureHtml(cfg, c, p, { logoSrc: `cid:${LOGO_CID}`, mailbox, withGreeting })}${quote ? `<br>${textToHtml(quote)}` : ""}`;
  const text = `${bodyClean.trimEnd()}\n\n${signatureText(cfg, c, p, { mailbox, withGreeting })}${quote ? `\n\n${quote}` : ""}`;
  const inline = cfg.showLogo ? [{ filename: "promont-logo.png", content: await logoPng(), contentType: "image/png", cid: LOGO_CID }] : [];
  return { ...m, text, html: `<!doctype html><html><body style="margin:0;padding:0;">${html}</body></html>`, attachments: [...(m.attachments ?? []), ...inline] };
}
