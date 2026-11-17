import { z } from "zod";

// E-Mail-Signatur (ohne server-only: dieselben Funktionen bauen die Vorschau im Browser und die Mail auf dem Server).
// Firmenteil stellt der Admin ein (AppSetting „MAIL_SIGNATUR“), Name/Position/Telefon pflegt jeder selbst.

export const SIGNATURE_LAYOUTS = ["seitlich", "untereinander"] as const;

const short = (max: number) => z.string().trim().max(max).default("");
export const personSchema = z.object({
  position: short(80),
  phone: short(40),
  mobile: short(40),
  email: z.union([z.literal(""), z.email().max(120)]).default(""),
});
export type SignaturePerson = z.infer<typeof personSchema>;

export const signatureSchema = z.object({
  enabled: z.boolean().default(true),
  /** auch unter Belegen, Mahnungen, Auftragsbestätigungen und Preisanfragen */
  forSystem: z.boolean().default(true),
  greeting: z.string().trim().max(80).default("Mit freundlichen Grüßen"),
  layout: z.enum(SIGNATURE_LAYOUTS).default("seitlich"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f4d83"),
  showLogo: z.boolean().default(true),
  logoWidth: z.number().int().min(100).max(260).default(170),
  showSubtitle: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showPhone: z.boolean().default(true),
  showMobile: z.boolean().default(false),
  showEmail: z.boolean().default(true),
  showWebsite: z.boolean().default(true),
  /** Pflichtangaben einer GmbH (§ 35a GmbHG): Sitz, Registergericht, HRB, Geschäftsführer */
  showLegal: z.boolean().default(true),
  note: short(600),
  users: z.record(z.string().max(40), personSchema).default({}),
});
export type SignatureConfig = z.infer<typeof signatureSchema>;
export const DEFAULT_SIGNATURE: SignatureConfig = signatureSchema.parse({});

/** Firmendaten, die in die Signatur gehen (aus src/lib/company.ts) */
export type SignatureCompany = {
  name: string;
  subtitle: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  web: string;
  managers: readonly string[];
  register: string;
  vatId: string;
};
export type SignatureSender = { name: string } & SignaturePerson;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tel = (s: string) => s.replace(/[^\d+]/g, "").replace(/^0/, "+49");
const managerNames = (c: SignatureCompany) => c.managers.map((m) => m.replace(/\s*\(.*\)\s*/, "").trim()).join(", ");
const legalLine = (c: SignatureCompany) => `${c.name} · Sitz ${c.city} · ${c.register} · Geschäftsführer: ${managerNames(c)} · USt-IdNr. ${c.vatId}`;

/** Grußformel nur ergänzen, wenn der Text nicht schon mit einem Gruß endet */
export function hasGreeting(text: string) {
  const tail = text.trim().split(/\r?\n/).slice(-4).join(" ");
  return /(grüße|gruß|gruss|regards|beste wünsche)/i.test(tail);
}

/** Zitat (Antwort/Weiterleitung) abtrennen, damit die Signatur darüber steht */
export function splitQuote(text: string): [string, string] {
  const m = text.match(/\n(?=Am [^\n]{3,120} schrieb [^\n]*:\n)|\n(?=-{6,} Weitergeleitete Nachricht -{6,}\n)/);
  if (!m || m.index === undefined) return [text, ""];
  return [text.slice(0, m.index), text.slice(m.index + 1)];
}

function contactLines(cfg: SignatureConfig, c: SignatureCompany, p: SignatureSender, mailbox: string) {
  const phone = p.phone || (cfg.showPhone ? c.phone : "");
  const mobile = p.mobile || (cfg.showMobile ? c.mobile : "");
  const email = p.email || (cfg.showEmail ? mailbox || c.email : "");
  return { phone, mobile, email, website: cfg.showWebsite ? c.web : "" };
}

/** Signatur als HTML (Tabellen + Inline-Stile, damit Outlook/Gmail/Apple Mail sie gleich zeigen) */
export function signatureHtml(cfg: SignatureConfig, c: SignatureCompany, p: SignatureSender, opts: { logoSrc: string; mailbox: string; withGreeting: boolean }) {
  const col = cfg.color;
  const k = contactLines(cfg, c, p, opts.mailbox);
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const small = `${font}font-size:12px;line-height:18px;color:#45525c;`;
  const link = `color:${col};text-decoration:none;`;
  const contact: string[] = [];
  if (k.phone) contact.push(`<span style="color:${col};font-weight:bold;">T</span>&nbsp;<a href="tel:${esc(tel(k.phone))}" style="${link}color:#45525c;">${esc(k.phone)}</a>`);
  if (k.mobile) contact.push(`<span style="color:${col};font-weight:bold;">M</span>&nbsp;<a href="tel:${esc(tel(k.mobile))}" style="${link}color:#45525c;">${esc(k.mobile)}</a>`);
  const web: string[] = [];
  if (k.email) web.push(`<a href="mailto:${esc(k.email)}" style="${link}">${esc(k.email)}</a>`);
  if (k.website) web.push(`<a href="${esc(c.website)}" style="${link}">${esc(k.website)}</a>`);

  const person = [
    `<div style="${font}font-size:15px;line-height:20px;font-weight:bold;color:#101820;">${esc(p.name)}</div>`,
    p.position ? `<div style="${font}font-size:13px;line-height:18px;color:${col};">${esc(p.position)}</div>` : "",
  ].join("");
  const companyBlock = [
    `<div style="${font}font-size:13px;line-height:19px;font-weight:bold;color:#101820;padding-top:8px;">${esc(c.name)}</div>`,
    cfg.showSubtitle ? `<div style="${small}">${esc(c.subtitle)}</div>` : "",
    cfg.showAddress ? `<div style="${small}">${esc(c.street)} · ${esc(c.zip)} ${esc(c.city)}</div>` : "",
    contact.length ? `<div style="${small}">${contact.join(" &nbsp;·&nbsp; ")}</div>` : "",
    web.length ? `<div style="${small}">${web.join(" &nbsp;·&nbsp; ")}</div>` : "",
  ].join("");
  const logo = cfg.showLogo ? `<img src="${esc(opts.logoSrc)}" width="${cfg.logoWidth}" alt="${esc(c.name)}" style="display:block;width:${cfg.logoWidth}px;height:auto;border:0;" />` : "";

  const main =
    cfg.layout === "seitlich" && logo
      ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>
<td style="vertical-align:middle;padding:0 18px 0 0;">${logo}</td>
<td style="vertical-align:top;padding:2px 0 2px 18px;border-left:3px solid ${col};">${person}${companyBlock}</td>
</tr></table>`
      : `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
<tr><td style="padding:0 0 10px 0;">${person}</td></tr>
<tr><td style="padding:10px 0 0 0;border-top:3px solid ${col};">${logo ? `<div style="padding:4px 0 2px 0;">${logo}</div>` : ""}${companyBlock}</td></tr>
</table>`;

  const legal = cfg.showLegal ? `<div style="${font}font-size:10px;line-height:15px;color:#8a949c;padding-top:12px;max-width:560px;">${esc(legalLine(c))}</div>` : "";
  const note = cfg.note ? `<div style="${font}font-size:10px;line-height:15px;color:#8a949c;padding-top:6px;max-width:560px;">${esc(cfg.note).replace(/\r?\n/g, "<br>")}</div>` : "";
  const greet = opts.withGreeting && cfg.greeting ? `<div style="${font}font-size:14px;line-height:21px;color:#101820;padding-bottom:12px;">${esc(cfg.greeting)}</div>` : "";
  return `<div style="padding-top:18px;">${greet}${main}${legal}${note}</div>`;
}

/** Signatur als reiner Text (Text-Teil der Mail) */
export function signatureText(cfg: SignatureConfig, c: SignatureCompany, p: SignatureSender, opts: { mailbox: string; withGreeting: boolean }) {
  const k = contactLines(cfg, c, p, opts.mailbox);
  const lines = [
    opts.withGreeting && cfg.greeting ? `${cfg.greeting}\n` : "",
    p.name,
    p.position,
    "",
    c.name,
    cfg.showSubtitle ? c.subtitle : "",
    cfg.showAddress ? `${c.street} · ${c.zip} ${c.city}` : "",
    [k.phone && `T ${k.phone}`, k.mobile && `M ${k.mobile}`].filter(Boolean).join(" · "),
    [k.email, k.website].filter(Boolean).join(" · "),
    cfg.showLegal ? `\n${legalLine(c)}` : "",
    cfg.note ? `\n${cfg.note}` : "",
  ];
  return `-- \n${lines.filter((l, i) => l !== "" || i === 3).join("\n").replace(/\n{3,}/g, "\n\n").trim()}`;
}

/** Mailtext als HTML (Zeilenumbrüche bleiben, Links/Mails klickbar, Zitate grau) */
export function textToHtml(text: string) {
  const font = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#101820;";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) out.push(`<div style="border-left:3px solid #d5dbe0;padding-left:10px;margin:4px 0;color:#64717c;">${quote.join("<br>")}</div>`);
    quote = [];
  };
  for (const l of lines) {
    const linked = esc(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0f4d83;">$1</a>');
    if (/^&gt; ?/.test(linked) || /^>/.test(l)) quote.push(linked.replace(/^&gt; ?/, "") || "&nbsp;");
    else {
      flush();
      out.push(linked || "&nbsp;");
    }
  }
  flush();
  return `<div style="${font}">${out.join("<br>").replace(/(<\/div>)<br>/g, "$1")}</div>`;
}
