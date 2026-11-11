// Kontaktdaten aus einem Impressum auslesen (reine Funktionen, ohne Netzwerk)

export type ImpressumData = { email: string | null; phone: string | null; owner: string | null };

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", commat: "@", period: "." };

function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

/** HTML → Text mit Zeilenumbrüchen an Block-Grenzen */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|address|dd|dt|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Link zum Impressum auf der Startseite finden (absolut aufgelöst) */
export function findImpressumLink(html: string, baseUrl: string): string | null {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const score = (href: string, text: string) =>
    /impressum/i.test(href) ? 3 : /impressum/i.test(text) ? 2 : /imprint|legal-notice|legal/i.test(href + text) ? 1 : 0;
  const best = links
    .map((m) => ({ href: m[1], s: score(m[1], htmlToText(m[2])) }))
    .filter((l) => l.s > 0 && !/^(mailto|tel|javascript):/i.test(l.href))
    .sort((a, b) => b.s - a.s)[0];
  if (!best) return null;
  try {
    return new URL(best.href, baseUrl).toString();
  } catch {
    return null;
  }
}

// Cloudflare-E-Mail-Schutz: <a data-cfemail="…"> bzw. /cdn-cgi/l/email-protection#…
function decodeCfEmail(hex: string): string | null {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out.includes("@") ? out : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const EMAIL_ONE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;
const IGNORE_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|@(example|beispiel|domain|sentry|wixpress)\.|^(name|vorname|max\.mustermann|ihre?|your)@|@2x\./i;

export function extractEmails(html: string, text: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']|email-protection#([0-9a-f]+)/gi)) {
    const e = decodeCfEmail(m[1] ?? m[2]);
    if (e) found.add(e);
  }
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(decodeEntities(m[1])));
  // Verschleierte Schreibweisen: info [at] firma [dot] de, info(at)firma.de, info@firma(punkt)de
  const deobf = text
    .replace(/\s*[[({]\s*(at|ät|@)\s*[\])}]\s*/gi, "@")
    .replace(/\s+(at)\s+(?=[a-z0-9-]+\s*(?:[[({]\s*(?:dot|punkt)|\.))/gi, "@")
    .replace(/\s*[[({]\s*(dot|punkt)\s*[\])}]\s*/gi, ".");
  for (const m of deobf.matchAll(EMAIL_RE)) found.add(m[0]);
  return [...found]
    .map((e) => e.trim().toLowerCase().replace(/\.$/, ""))
    .filter((e) => EMAIL_ONE.test(e) && !IGNORE_EMAIL.test(e));
}

/** Beste E-Mail: gleiche Domain wie die Website bevorzugt, dann info@/kontakt@ */
export function pickEmail(emails: string[], siteUrl: string | null): string | null {
  if (emails.length === 0) return null;
  let host = "";
  try {
    host = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, "") : "";
  } catch {}
  const rank = (e: string) => {
    const domain = e.split("@")[1] ?? "";
    let r = 0;
    if (host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`))) r += 10;
    if (/^(info|kontakt|contact|hallo|hello|mail|office|post|service)@/.test(e)) r += 3;
    if (/^(datenschutz|privacy|dsb|webmaster|noreply|no-reply)@/.test(e)) r -= 5;
    return r;
  };
  return [...emails].sort((a, b) => rank(b) - rank(a))[0];
}

const PHONE_LABEL = /(?:^|\n|\s)(?:tel(?:efon)?|fon|phone|mobil|handy|fax)\.?\s*(?:\([^)]*\))?\s*[:.]?\s*(\+?[\d][\d\s/().–-]{5,22}\d)/gi;

export function extractPhone(text: string): string | null {
  for (const m of text.matchAll(PHONE_LABEL)) {
    // Fax überspringen
    if (/fax/i.test(m[0].slice(0, m[0].indexOf(m[1])))) continue;
    const digits = m[1].replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 15) continue;
    return m[1].replace(/\s+/g, " ").replace(/[–]/g, "-").trim();
  }
  return null;
}

const OWNER_LABELS = [
  "Inhaberin",
  "Inhaber",
  "Geschäftsführerin",
  "Geschäftsführer",
  "Geschäftsführung",
  "Vertreten durch",
  "Vertretungsberechtigte[r]? Geschäftsführer(?:in)?",
  "Vertretungsberechtigt",
  "Praxisinhaber(?:in)?",
  "Betreiber(?:in)?",
  "Anbieter(?:in)?",
  "Diensteanbieter(?:in)?",
  "Verantwortlich(?:e[r]?)? (?:für den Inhalt|i\\.?\\s?S\\.?\\s?d\\.?)[^:\\n]*",
  "Ansprechpartner(?:in)?",
];

// Wörter, die auf einen Firmen- statt Personennamen hindeuten
const BUSINESS_WORDS =
  /\b(salon|studio|praxis|bäckerei|metzgerei|restaurant|ristorante|café|cafe|bar|hotel|autohaus|werkstatt|kanzlei|agentur|media|design|service|team|haus|shop|laden|zentrum|center|friseur|optik|apotheke|schreinerei|malerbetrieb|elektro|immobilien|fitness|physiotherapie|zahnarzt|gmbh|ug|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?v\.?|mbh|holding|group|deutschland)\b/i;

/** Namen nach typischen Bezeichnungen (Inhaber:, Geschäftsführer: …) */
export function extractOwner(text: string, businessName?: string | null): string | null {
  for (const label of OWNER_LABELS) {
    const re = new RegExp(`(?:^|\\n|\\s)${label}\\s*(?:\\([^)]*\\))?\\s*[:\\n]\\s*([^\\n]{3,80})`, "i");
    const raw = text.match(re)?.[1];
    if (!raw) continue;
    const name = cleanName(raw);
    if (name && !BUSINESS_WORDS.test(name)) return name;
  }
  // Rückfall: bei Einzelunternehmen steht der Name oft direkt unter „Angaben gemäß § 5 TMG/DDG“
  const after = text.match(/angaben gem(?:ä|ae)(?:ss|ß)\s*§\s*5\s*(?:tmg|ddg)[^\n]*\n((?:[^\n]*\n?){1,3})/i)?.[1];
  if (after) {
    const skip = businessName?.toLowerCase().split(/\s+/).filter((w) => w.length > 3) ?? [];
    for (const line of after.split("\n")) {
      const name = cleanName(line);
      if (!name || BUSINESS_WORDS.test(name)) continue;
      if (skip.some((w) => name.toLowerCase().includes(w))) continue;
      return name;
    }
  }
  return null;
}

function cleanName(raw: string): string | null {
  const name = raw
    .split(/[,;|]| und | sowie |\s{2,}|\s[-–]\s/)[0]
    .replace(/^(die|der|den|herrn?|frau)\s+/i, "")
    .replace(/[.:]$/, "")
    .trim();
  // Plausibel: 2–5 Wörter, keine Ziffern/Adressen/E-Mails, beginnt mit Großbuchstabe oder Titel
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 5) return null;
  if (/\d|@|straße|str\.|gmbh|ug\b|e\.k\.|www\.|http/i.test(name)) return null;
  if (!/^(Dr\.|Prof\.|[A-ZÄÖÜ])/.test(name)) return null;
  return name;
}

export function extractImpressum(html: string, siteUrl: string | null, businessName?: string | null): ImpressumData {
  const text = htmlToText(html);
  return {
    email: pickEmail(extractEmails(html, text), siteUrl),
    phone: extractPhone(text),
    owner: extractOwner(text, businessName),
  };
}
