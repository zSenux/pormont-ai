import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { sendPush } from "@/lib/push";
import { safeFetch } from "@/lib/akquise/safe-fetch";
import { canArea } from "@/lib/rights-shared";

// Ausschreibungen finden: täglich öffentliche Bekanntmachungen holen und nach Passung für ProMont bewerten.
// Quellen (nur echte, öffentliche Daten – nichts wird erfunden):
//  - TED, das EU-Amtsblatt (Search API v3, ohne Schlüssel): Bauaufträge mit Metallbau-CPV-Codes in der Region
//  - RSS-Feeds, z. B. die Suche auf service.bund.de („RSS-Feed“ unter den Ergebnissen) oder Vergabeplattformen
//  - von Hand erfasst (z. B. aus einem Newsletter)
// Bewertung 0–100 aus Stichwörtern (Titel/Beschreibung), CPV-Code und Region (PLZ-Bereich). Neue Treffer → Push.

export class TenderError extends Error {}

const KEY = "AUSSCHREIBUNGEN";

/** CPV-Codes für Metallbau/Stahlbau (Bauleistungen und Lieferungen) */
export const DEFAULT_CPV = ["45262400", "45223100", "45223110", "45340000", "45342000", "44233000", "45421148", "44212000", "45421100", "45443000"];
export const CPV_LABEL: Record<string, string> = {
  "45262400": "Stahlbauarbeiten",
  "45223100": "Montage von Metallkonstruktionen",
  "45223110": "Einbau von Metallkonstruktionen",
  "45340000": "Zäune, Geländer, Sicherheitseinrichtungen",
  "45342000": "Errichtung von Zäunen",
  "44233000": "Treppen",
  "45421148": "Einbau von Toren",
  "44212000": "Konstruktionen und Teile (Stahl)",
  "45421100": "Einbau von Türen und Fenstern",
  "45443000": "Fassadenarbeiten",
};
export const DEFAULT_KEYWORDS = ["Metallbau", "Stahlbau", "Schlosser", "Geländer", "Handlauf", "Treppe", "Stahltreppe", "Fluchttreppe", "Vordach", "Überdachung", "Carport", "Tor", "Schiebetor", "Zaun", "Gitter", "Gitterrost", "Stahlkonstruktion", "Edelstahl", "Brandschutztür", "Stahltür", "Podest", "Bühne", "Absturzsicherung"];
/** PLZ-Bereiche rund um Mannheim: Mannheim/Heidelberg (68, 69), Pfalz/Ludwigshafen (67), Bergstraße/Darmstadt (64), Heilbronn (74), Karlsruhe (76) */
export const DEFAULT_PLZ = ["68", "69", "67", "64", "74", "76"];

export const tenderConfigSchema = z.object({
  ted: z.boolean().default(true),
  cpv: z.array(z.string().regex(/^\d{8}$/)).max(40).default(DEFAULT_CPV),
  keywords: z.array(z.string().trim().min(2).max(40)).max(80).default(DEFAULT_KEYWORDS),
  plz: z.array(z.string().regex(/^\d{1,5}$/)).max(40).default(DEFAULT_PLZ),
  rss: z.array(z.url().max(1000)).max(10).default([]),
  /** ab dieser Passung gibt es eine Push-Nachricht */
  minScore: z.number().int().min(0).max(100).default(40),
  /** Rückblick beim Abruf in Tagen */
  days: z.number().int().min(1).max(60).default(10),
});
export type TenderConfig = z.infer<typeof tenderConfigSchema>;

export async function tenderConfig(): Promise<TenderConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {}
  const p = tenderConfigSchema.safeParse(raw);
  return p.success ? p.data : tenderConfigSchema.parse({});
}

export async function saveTenderConfig(c: Partial<TenderConfig>) {
  const value = JSON.stringify(tenderConfigSchema.parse({ ...(await tenderConfig()), ...c }));
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export const TENDER_STATUS_LABEL = { NEU: "Neu", INTERESSANT: "Interessant", ANGEBOT: "Angebot in Arbeit", ABGELEHNT: "Nicht für uns" } as const;
export type TenderStatus = keyof typeof TENDER_STATUS_LABEL;
export const TENDER_STATUSES = Object.keys(TENDER_STATUS_LABEL) as [TenderStatus, ...TenderStatus[]];

type Found = { source: "TED" | "RSS" | "MANUELL"; externalId: string; title: string; buyer?: string | null; place?: string | null; postalCode?: string | null; cpv?: string | null; description?: string | null; url?: string | null; publishedAt?: Date | null; deadline?: Date | null };

/** Passung 0–100: Stichwörter (bis 50), CPV (30), Region (20 bzw. −20 außerhalb) */
export function scoreTender(t: Pick<Found, "title" | "description" | "cpv" | "postalCode" | "place">, cfg: TenderConfig) {
  const hay = `${t.title} ${t.description ?? ""}`.toLowerCase();
  const kw = cfg.keywords.filter((k) => hay.includes(k.toLowerCase()));
  const cpvHit = Boolean(t.cpv && cfg.cpv.some((c) => t.cpv!.split(/[,\s]+/).some((x) => x.startsWith(c.replace(/0+$/, "")))));
  const plz = t.postalCode?.match(/\d{5}/)?.[0];
  const region = plz ? cfg.plz.some((p) => plz.startsWith(p)) : null;
  let s = Math.min(50, kw.length * 20) + (cpvHit ? 30 : 0) + (region === true ? 20 : region === false ? -20 : 0);
  s = Math.max(0, Math.min(100, s));
  const matched = [...kw, ...(cpvHit ? ["CPV"] : []), ...(region ? [`PLZ ${plz}`] : [])].join(", ");
  return { score: s, matched: matched || null };
}

// ---------- TED (EU-Amtsblatt) ----------

const TED_URL = "https://api.ted.europa.eu/v3/notices/search";
// Feldnamen laut TED-Hilfe (Expertensuche). Falls TED ein Feld nicht als Rückgabefeld kennt (400), wird mit weniger Feldern neu gefragt.
const TED_FIELD_SETS = [
  ["publication-number", "notice-title", "buyer-name", "buyer-city", "buyer-post-code", "place-of-performance", "classification-cpv", "publication-date", "deadline-receipt-tender-date-lot", "description-lot", "links"],
  ["publication-number", "notice-title", "buyer-name", "buyer-city", "buyer-post-code", "classification-cpv", "publication-date", "deadline-receipt-tender-date-lot", "links"],
  ["publication-number", "notice-title", "buyer-name", "buyer-city", "publication-date", "links"],
];

/** Mehrsprachige TED-Werte ({ deu: [...], eng: [...] } oder Liste) → ein Text, Deutsch bevorzugt */
function lang(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(lang).filter(Boolean).join(", ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return lang(o.deu ?? o.DEU ?? o.ger ?? o.eng ?? o.ENG ?? Object.values(o)[0]);
  }
  return null;
}
const tedDate = (v: unknown) => {
  const s = lang(v)?.split(",")[0]?.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? berlinDateTime(`${m[1]}-${m[2]}-${m[3]}`, s.match(/T(\d{2}:\d{2})/)?.[1] ?? "00:00") : null;
};

export function tedQuery(cfg: TenderConfig, since: string) {
  const cpv = cfg.cpv.length ? ` AND classification-cpv IN (${cfg.cpv.join(" ")})` : "";
  return `buyer-country = DEU AND publication-date >= ${since.replace(/-/g, "")}${cpv}`;
}

async function fetchTed(cfg: TenderConfig): Promise<Found[]> {
  const since = addDaysYmd(todayYmd(), -cfg.days);
  const out: Found[] = [];
  let set = 0;
  for (let page = 1; page <= 4; page++) {
    const res = await fetch(TED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: tedQuery(cfg, since), fields: TED_FIELD_SETS[set], page, limit: 100, scope: "ACTIVE", paginationMode: "PAGE_NUMBER" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 400 && set < TED_FIELD_SETS.length - 1) {
      set++;
      page--;
      continue;
    }
    if (!res.ok) throw new TenderError(`TED antwortet mit ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { notices?: Record<string, unknown>[]; totalNoticeCount?: number };
    for (const n of j.notices ?? []) {
      const id = lang(n["publication-number"]);
      if (!id) continue;
      const links = n.links as { html?: Record<string, string> } | undefined;
      const place = lang(n["place-of-performance"]);
      const plz = lang(n["buyer-post-code"]);
      out.push({
        source: "TED",
        externalId: id,
        title: (lang(n["notice-title"]) ?? `Bekanntmachung ${id}`).slice(0, 500),
        buyer: lang(n["buyer-name"])?.slice(0, 300) ?? null,
        place: [lang(n["buyer-city"]), place].filter(Boolean).join(" · ").slice(0, 300) || null,
        postalCode: plz?.match(/\d{5}/)?.[0] ?? null,
        cpv: lang(n["classification-cpv"])?.slice(0, 300) ?? null,
        description: lang(n["description-lot"])?.slice(0, 4000) ?? null,
        url: links?.html?.DEU ?? links?.html?.deu ?? links?.html?.ENG ?? `https://ted.europa.eu/de/notice/-/detail/${id}`,
        publishedAt: tedDate(n["publication-date"]),
        deadline: tedDate(n["deadline-receipt-tender-date-lot"]),
      });
    }
    if (!j.notices?.length || out.length >= (j.totalNoticeCount ?? 0)) break;
  }
  return out;
}

// ---------- RSS (service.bund.de u. a.) ----------

const unxml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

export function parseRss(xml: string): Found[] {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return items.slice(0, 200).flatMap((it) => {
    const title = unxml(tag(it, "title") ?? "");
    const link = unxml(tag(it, "link") ?? "") || it.match(/<link[^>]*href="([^"]+)"/i)?.[1] || null;
    const guid = unxml(tag(it, "guid") ?? tag(it, "id") ?? "") || link;
    if (!title || !guid) return [];
    const desc = unxml(tag(it, "description") ?? tag(it, "summary") ?? tag(it, "content") ?? "");
    const pub = tag(it, "pubDate") ?? tag(it, "updated") ?? tag(it, "dc:date");
    const d = pub ? new Date(unxml(pub)) : null;
    const dl = desc.match(/(?:Frist|Angebotsfrist|Abgabefrist|Schlusstermin)[^0-9]{0,40}(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
    return [{ source: "RSS" as const, externalId: guid.slice(0, 500), title: title.slice(0, 500), description: desc.slice(0, 4000) || null, url: link, publishedAt: d && !isNaN(d.getTime()) ? d : null, deadline: dl ? berlinDateTime(`${dl[3]}-${dl[2].padStart(2, "0")}-${dl[1].padStart(2, "0")}`) : null, postalCode: desc.match(/\b(\d{5})\s+[A-ZÄÖÜ][a-zäöüß]/)?.[1] ?? null }];
  });
}

async function fetchRss(url: string): Promise<Found[]> {
  const r = await safeFetch(url, 25_000);
  if (r.status >= 400) throw new TenderError(`Feed ${new URL(url).host} antwortet mit ${r.status}.`);
  return parseRss(r.body);
}

// ---------- Abruf ----------

/** Alle Quellen abrufen, neue Ausschreibungen speichern. Fehler einzelner Quellen werden gemeldet, nicht geworfen. */
export async function refreshTenders() {
  const cfg = await tenderConfig();
  const errors: string[] = [];
  const found: Found[] = [];
  if (cfg.ted) found.push(...(await fetchTed(cfg).catch((e) => (errors.push(`TED: ${e instanceof Error ? e.message : e}`), []))));
  for (const u of cfg.rss) found.push(...(await fetchRss(u).catch((e) => (errors.push(`RSS ${u.slice(0, 60)}: ${e instanceof Error ? e.message : e}`), []))));
  const fresh = [];
  for (const f of found) {
    const { score, matched } = scoreTender(f, cfg);
    // TED liefert ganz Deutschland: außerhalb der PLZ-Bereiche ohne Stichwort nicht speichern
    const plz = f.postalCode;
    if (f.source === "TED" && plz && !cfg.plz.some((p) => plz.startsWith(p))) continue;
    if (score < 20) continue;
    const exists = await db.tender.findUnique({ where: { source_externalId: { source: f.source, externalId: f.externalId } }, select: { id: true } });
    if (exists) {
      await db.tender.update({ where: { id: exists.id }, data: { deadline: f.deadline ?? undefined, score, matched } });
      continue;
    }
    try {
      fresh.push(await db.tender.create({ data: { ...f, score, matched } }));
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  await db.jobState.upsert({ where: { key: "tender:last" }, create: { key: "tender:last", value: JSON.stringify({ at: new Date().toISOString(), found: found.length, fresh: fresh.length, errors }) }, update: { value: JSON.stringify({ at: new Date().toISOString(), found: found.length, fresh: fresh.length, errors }) } });
  return { found: found.length, fresh, errors, cfg };
}

export async function lastRefresh() {
  const s = await db.jobState.findUnique({ where: { key: "tender:last" } });
  try {
    return s ? (JSON.parse(s.value) as { at: string; found: number; fresh: number; errors: string[] }) : null;
  } catch {
    return null;
  }
}

/** Täglicher Job (werktags ab 6 Uhr, einmal je Tag): abrufen und passende neue Treffer melden */
export async function dailyTenders(once: (key: string) => Promise<boolean>) {
  const p = berlinParts();
  if (["Sat", "Sun"].includes(p.weekday) || p.h < 6 || p.h >= 20) return;
  if (!(await once(`tender:${p.ymd}`))) return;
  const { fresh, cfg } = await refreshTenders();
  const good = fresh.filter((t) => t.score >= cfg.minScore).sort((a, b) => b.score - a.score);
  if (!good.length) return;
  const users = (await db.user.findMany({ select: { id: true, role: true, funktion: true } })).filter((u) => canArea(u, "akquise") && (u.role === "ADMIN" || u.funktion === "VERTRIEB" || u.funktion === "GF"));
  const msg = good.length === 1 ? { title: "📋 Neue Ausschreibung", body: `${good[0].title}${good[0].deadline ? ` – Frist ${formatDate(good[0].deadline)}` : ""}`, url: `/ausschreibungen/${good[0].id}` } : { title: `📋 ${good.length} neue Ausschreibungen`, body: good.slice(0, 3).map((t) => t.title).join(" · "), url: "/ausschreibungen" };
  for (const u of users) await sendPush({ ...msg, tag: "ausschreibungen", userId: u.id });
}

export async function addManualTender(i: { title: string; buyer?: string | null; place?: string | null; postalCode?: string | null; url?: string | null; deadline?: string | null; description?: string | null }, actor: { name: string }) {
  const cfg = await tenderConfig();
  const { score, matched } = scoreTender({ title: i.title, description: i.description, postalCode: i.postalCode, place: i.place, cpv: null }, cfg);
  return db.tender.create({ data: { source: "MANUELL", externalId: `manuell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: i.title, buyer: i.buyer || null, place: i.place || null, postalCode: i.postalCode || null, url: i.url || null, description: i.description || null, deadline: i.deadline ? berlinDateTime(i.deadline, "12:00") : null, score, matched, status: "INTERESSANT", decidedBy: actor.name } });
}

export function tenderLine(t: { id: string; title: string; buyer: string | null; place: string | null; deadline: Date | null; score: number; status: string; url: string | null; source: string }) {
  const days = t.deadline ? Math.ceil((t.deadline.getTime() - Date.now()) / 86400_000) : null;
  return `- „${t.title}“${t.buyer ? ` · ${t.buyer}` : ""}${t.place ? ` · ${t.place}` : ""}${t.deadline ? ` · Frist ${formatDate(t.deadline)}${days !== null && days >= 0 ? ` (noch ${days} Tage)` : " (abgelaufen)"}` : ""} · Passung ${t.score} % · ${TENDER_STATUS_LABEL[t.status as TenderStatus] ?? t.status} · Quelle ${t.source}${t.url ? ` · ${t.url}` : ""} · id ${t.id}`;
}

export const tenderOpen = (t: { deadline: Date | null }) => !t.deadline || t.deadline.getTime() >= Date.now();
export const deadlineDay = (t: { deadline: Date | null }) => (t.deadline ? berlinParts(t.deadline).ymd : null);
