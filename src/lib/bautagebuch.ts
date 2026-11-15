import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { CREW_ROLES, crewByRole, readHead, readReport, reportSchema, shiftText, weatherFlags, type Report } from "@/lib/bautagebuch-shared";

// Bautagebuch: je Projekt und Tag ein Eintrag – Wetter (Open-Meteo, echte Messwerte), Personal (Vorschlag aus
// Stunden/Montage-Team), ausgeführte Arbeiten, Material, Behinderungen, Besucher/Anordnungen, Fotos.
// PDF-Export für den Bauherrn (pdf-lib, ProMont-Kopf, Fotos, Unterschriftsfelder).

export class DiaryError extends Error {}

export const crewSchema = z.array(z.object({ name: z.string().trim().min(1).max(80), userId: z.string().max(40).nullish(), hours: z.number().min(0).max(24).nullish(), role: z.enum(CREW_ROLES).nullish() })).max(40);
export type CrewMember = z.infer<typeof crewSchema>[number];
export const readCrew = (raw: unknown): CrewMember[] => {
  const p = crewSchema.safeParse(raw);
  return p.success ? p.data : [];
};

const ymd = (d: Date) => berlinParts(d).ymd;
export const fmtHours = (h: number) => `${h.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Std.`;

// ---------- Wetter (Open-Meteo, ohne Schlüssel) ----------

const WMO: Record<number, string> = {
  0: "sonnig", 1: "überwiegend sonnig", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 56: "gefrierender Niesel", 57: "gefrierender Niesel",
  61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefrierender Regen", 67: "gefrierender Regen",
  71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel",
  80: "Regenschauer", 81: "Regenschauer", 82: "heftige Regenschauer", 85: "Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit Hagel",
};
export const weatherLabel = (code: number | null | undefined) => (code === null || code === undefined ? null : (WMO[code] ?? `Wettercode ${code}`));

export type Weather = { weather: string; weatherCode: number | null; tempMin: number | null; tempMax: number | null; rainMm: number | null; windKmh: number | null };

export function weatherText(w: Omit<Weather, "weather">) {
  const r = (n: number) => Math.round(n);
  return [
    weatherLabel(w.weatherCode),
    w.tempMin !== null && w.tempMax !== null ? `${r(w.tempMin)}–${r(w.tempMax)} °C` : null,
    w.rainMm !== null ? (w.rainMm >= 0.1 ? `${w.rainMm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} mm Niederschlag` : "trocken") : null,
    w.windKmh !== null ? `Wind bis ${r(w.windKmh)} km/h` : null,
  ].filter(Boolean).join(", ");
}

const MANNHEIM = { lat: 49.4875, lon: 8.466, name: "Mannheim" };

/** Ort aus der Projektadresse („…, 68309 Mannheim“) → Koordinaten (Open-Meteo-Geocoding), sonst Mannheim */
async function locate(address: string | null) {
  const m = address?.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß .\-]+)/);
  const city = m?.[2]?.trim();
  if (!city) return MANNHEIM;
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=de&countryCode=DE`, { signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { results?: { latitude: number; longitude: number; name: string; postcodes?: string[] }[] };
    const hit = j.results?.find((r) => r.postcodes?.includes(m![1])) ?? j.results?.[0];
    return hit ? { lat: hit.latitude, lon: hit.longitude, name: hit.name } : MANNHEIM;
  } catch {
    return MANNHEIM;
  }
}

/** Tageswetter am Ort der Baustelle (gemessen bzw. Vorhersage für heute) */
export async function fetchWeather(address: string | null, day: string): Promise<Weather & { place: string }> {
  if (day > todayYmd()) throw new DiaryError("Wetter gibt es nur für heute und vergangene Tage.");
  const loc = await locate(address);
  const old = day < addDaysYmd(todayYmd(), -80);
  const base = old ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const url = `${base}?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Europe%2FBerlin&start_date=${day}&end_date=${day}`;
  let j: { daily?: Record<string, (number | null)[]> };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    j = await res.json();
  } catch {
    throw new DiaryError("Wetterdienst nicht erreichbar – bitte Wetter von Hand eintragen.");
  }
  const v = (k: string) => (typeof j.daily?.[k]?.[0] === "number" ? (j.daily![k]![0] as number) : null);
  const w = { weatherCode: v("weather_code"), tempMin: v("temperature_2m_min"), tempMax: v("temperature_2m_max"), rainMm: v("precipitation_sum"), windKmh: v("wind_speed_10m_max") };
  if (w.weatherCode === null && w.tempMax === null) throw new DiaryError("Für diesen Tag liefert der Wetterdienst keine Daten.");
  return { ...w, weather: weatherText(w), place: loc.name };
}

// ---------- Einträge ----------

/** Vorschlag für das Personal: gebuchte Stunden auf dem Projekt an dem Tag + Montage-Team */
export async function crewSuggestion(projectId: string, day: string): Promise<CrewMember[]> {
  const start = berlinDateTime(day), end = berlinDateTime(addDaysYmd(day, 1));
  const [times, asm] = await Promise.all([
    db.timeEntry.findMany({ where: { projectId, day: { gte: start, lt: end }, absenceId: null }, include: { user: { select: { id: true, name: true } } } }),
    db.assembly.findMany({ where: { projectId, status: { not: "ABGESAGT" }, startAt: { lt: end }, OR: [{ endAt: null, startAt: { gte: start } }, { endAt: { gte: start } }] }, include: { crew: { include: { user: { select: { id: true, name: true } } } }, leader: { select: { id: true, name: true } } } }),
  ]);
  const map = new Map<string, CrewMember>();
  for (const t of times) {
    const c = map.get(t.user.id) ?? { name: t.user.name, userId: t.user.id, hours: 0 };
    c.hours = Math.round(((c.hours ?? 0) + t.minutes / 60) * 100) / 100;
    map.set(t.user.id, c);
  }
  for (const a of asm) for (const u of [a.leader, ...a.crew.map((c) => c.user)]) if (u && !map.has(u.id)) map.set(u.id, { name: u.name, userId: u.id, hours: null });
  return [...map.values()];
}

export const diaryInput = z.object({
  projectId: z.cuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.string().trim().max(300).nullish(),
  crew: crewSchema.optional(),
  work: z.string().trim().max(8000).nullish(),
  material: z.string().trim().max(4000).nullish(),
  obstacles: z.string().trim().max(4000).nullish(),
  visitors: z.string().trim().max(4000).nullish(),
  /** Bautagesbericht: Formular ersetzt ihn ganz, Jarvis ergänzt einzelne Felder */
  report: reportSchema.optional(),
});
export type DiaryInput = z.infer<typeof diaryInput>;

/** Eintrag des Tages anlegen oder ergänzen (leere Felder bleiben unverändert). Wetter wird beim ersten Speichern automatisch geholt. */
export async function saveDiary(input: DiaryInput, actor: { name: string }, opts: { append?: boolean } = {}) {
  const i = diaryInput.parse(input);
  if (i.day > todayYmd()) throw new DiaryError("Das Bautagebuch wird für heute oder vergangene Tage geführt.");
  const project = await db.project.findUnique({ where: { id: i.projectId }, select: { id: true, address: true } });
  if (!project) throw new DiaryError("Projekt nicht gefunden.");
  const day = berlinDateTime(i.day);
  const old = await db.diaryEntry.findUnique({ where: { projectId_day: { projectId: project.id, day } } });
  // Formular ersetzt die Texte, Jarvis ergänzt (append)
  const join = (a: string | null | undefined, b: string | null | undefined) => (opts.append ? (a && b ? `${a}\n${b}` : (b ?? a ?? null)) : (b ?? null));
  const text = (k: "work" | "material" | "obstacles" | "visitors") => (i[k] === undefined ? undefined : join(old?.[k], i[k] || null));
  let weather: Partial<Weather> & { weatherSource?: string } = {};
  if (i.weather) weather = { weather: i.weather, weatherSource: "manuell", weatherCode: null, tempMin: null, tempMax: null, rainMm: null, windKmh: null };
  else if (!old?.weather) weather = await fetchWeather(project.address, i.day).then((w) => ({ ...w, weatherSource: "open-meteo" })).catch(() => ({}));
  const crew = i.crew ?? (old ? undefined : await crewSuggestion(project.id, i.day));
  const report = await mergeReport(project.id, i.day, old ? readReport(old.report) : null, i.report, opts.append);
  const data = { ...weather, ...(crew ? { crew } : {}), work: text("work"), material: text("material"), obstacles: text("obstacles"), visitors: text("visitors"), ...(report ? { report } : {}) };
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  try {
    return old
      ? await db.diaryEntry.update({ where: { id: old.id }, data: clean })
      : await db.diaryEntry.create({ data: { projectId: project.id, day, authorName: actor.name, ...clean } });
  } catch (e) {
    // Gleichzeitig angelegt (eindeutig je Projekt und Tag) → ergänzen
    if (!old && (e as { code?: string }).code === "P2002") return saveDiary(input, actor, opts);
    throw e;
  }
}

/** Vorschlag für einen neuen Bericht: nächste Bericht-Nr., Richtmeister/Gewerk/Schichtzeiten vom letzten Bericht davor */
export async function reportDefaults(projectId: string, day: string): Promise<Report> {
  const [p, all, prev] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { diaryHead: true, leader: { select: { name: true } } } }),
    db.diaryEntry.findMany({ where: { projectId }, select: { report: true } }),
    db.diaryEntry.findFirst({ where: { projectId, day: { lt: berlinDateTime(day) } }, orderBy: { day: "desc" }, select: { report: true } }),
  ]);
  const head = readHead(p?.diaryHead);
  const last = readReport(prev?.report);
  const max = Math.max(0, ...all.map((e) => readReport(e.report).no ?? 0));
  return {
    no: max ? max + 1 : (head.startNo ?? all.length + 1),
    foreman: last.foreman ?? p?.leader?.name ?? null,
    trade: last.trade ?? head.trade ?? null,
    earlyFrom: last.earlyFrom ?? null,
    earlyTo: last.earlyTo ?? null,
    lateFrom: last.lateFrom ?? null,
    lateTo: last.lateTo ?? null,
  };
}

/** Bericht zusammenführen: neu → Vorschlag + Eingabe; Formular ersetzt; Jarvis (append) ergänzt nur genannte Felder, Anordnungen/Änderungen werden angehängt */
async function mergeReport(projectId: string, day: string, old: Report | null, input: Report | undefined, append?: boolean): Promise<Report | null> {
  if (!old) return { ...(await reportDefaults(projectId, day)), ...strip(input ?? {}) };
  if (!input) return null;
  if (!append) return { ...input, no: input.no ?? old.no };
  const add = strip(input);
  return {
    ...old,
    ...add,
    equipment: { ...(old.equipment ?? {}), ...(add.equipment ?? {}) },
    changes: [...(old.changes ?? []), ...(add.changes ?? [])].slice(0, 12),
    orders: old.orders && add.orders ? `${old.orders}\n${add.orders}` : (add.orders ?? old.orders),
  };
}
const strip = (r: Report) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Report;

/** Kopf der Bautagesberichte je Projekt speichern */
export async function saveHead(projectId: string, raw: unknown) {
  const head = strip(readHead(raw) as Report) as ReturnType<typeof readHead>;
  return db.project.update({ where: { id: projectId }, data: { diaryHead: head }, select: { id: true } });
}

/** Wetter neu holen (überschreibt Hand-Eingabe) */
export async function refreshWeather(entryId: string) {
  const e = await db.diaryEntry.findUnique({ where: { id: entryId }, include: { project: { select: { address: true } } } });
  if (!e) throw new DiaryError("Eintrag nicht gefunden.");
  const w = await fetchWeather(e.project.address, ymd(e.day));
  return db.diaryEntry.update({ where: { id: e.id }, data: { weather: w.weather, weatherCode: w.weatherCode, tempMin: w.tempMin, tempMax: w.tempMax, rainMm: w.rainMm, windKmh: w.windKmh, weatherSource: "open-meteo" } });
}

export function diaryText(e: { day: Date; weather: string | null; crew: unknown; work: string | null; material: string | null; obstacles: string | null; visitors: string | null; authorName: string | null; id: string; report?: unknown; _count?: { files: number } }) {
  const crew = readCrew(e.crew);
  const hrs = crew.reduce((s, c) => s + (c.hours ?? 0), 0);
  const r = readReport(e.report);
  const eq = Object.entries(r.equipment ?? {}).filter(([, v]) => v);
  return [
    `${r.no ? `Bericht Nr. ${r.no}, ` : ""}${formatDate(e.day)}${e.authorName ? ` (${e.authorName})` : ""} · id ${e.id}`,
    (r.foreman || r.trade) && `  Richtmeister: ${r.foreman ?? "–"} · Gewerk: ${r.trade ?? "–"}`,
    (r.earlyFrom || r.lateFrom) && `  Schichten: ${[shiftText(r.earlyFrom, r.earlyTo) && `Früh/Tag ${shiftText(r.earlyFrom, r.earlyTo)}`, shiftText(r.lateFrom, r.lateTo) && `Spät/Nacht ${shiftText(r.lateFrom, r.lateTo)}`].filter(Boolean).join(", ")}`,
    e.weather && `  Wetter: ${e.weather}`,
    crew.length && `  Personal: ${crew.map((c) => `${c.name}${c.role && c.role !== "Monteur" ? ` [${c.role}]` : ""}${c.hours ? ` ${fmtHours(c.hours)}` : ""}`).join(", ")}${hrs ? ` = ${fmtHours(hrs)}` : ""}`,
    eq.length && `  Geräte: ${eq.map(([k, v]) => `${k} ${v}`).join(", ")}`,
    e.work && `  Arbeiten: ${e.work}`,
    r.changes?.length && `  Änderungen: ${r.changes.map((c) => `${c.men ?? 0} Mann × ${c.hours ?? 0} Std. ${c.text ?? ""}`.trim()).join("; ")}`,
    r.orders && `  Anordnungen: ${r.orders}`,
    e.material && `  Material/Lieferungen: ${e.material}`,
    e.obstacles && `  Behinderungen/Besonderheiten: ${e.obstacles}`,
    e.visitors && `  Besucher/Anordnungen: ${e.visitors}`,
    e._count?.files ? `  ${e._count.files} Fotos` : null,
  ].filter(Boolean).join("\n");
}

// ---------- PDF für den Bauherrn ----------

const MM = 72 / 25.4;
const W = 210 * MM, H = 297 * MM, LEFT = 20 * MM, RIGHT = W - 20 * MM, BOTTOM = 22 * MM;
const BRAND = rgb(15 / 255, 77 / 255, 131 / 255), INK = rgb(16 / 255, 24 / 255, 32 / 255), STEEL = rgb(100 / 255, 113 / 255, 124 / 255), LINE = rgb(216 / 255, 224 / 255, 230 / 255), MIST = rgb(242 / 255, 245 / 255, 247 / 255);

export function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** Nur Zeichen, die die eingebettete Schrift kann (Emojis u. ä. fallen weg) */
export const safe = (font: PDFFont, s: string) => {
  const ok = new Set(font.getCharacterSet());
  return [...s].map((ch) => (ok.has(ch.codePointAt(0)!) || ch === "\n" ? ch : "")).join("");
};

export async function diaryPdf(projectId: string, from: string, to: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { customerRef: { select: { name: true } }, leader: { select: { name: true } } } });
  if (!p) throw new DiaryError("Projekt nicht gefunden.");
  const entries = await db.diaryEntry.findMany({
    where: { projectId, day: { gte: berlinDateTime(from), lte: berlinDateTime(to) } },
    orderBy: { day: "asc" },
    include: { files: { where: { mime: { in: ["image/jpeg", "image/png"] } }, orderBy: { createdAt: "asc" }, take: 6, select: { data: true, mime: true, summary: true } } },
  });
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), "src/lib/buchhaltung/assets");
  const [reg, bold, logoBytes] = await Promise.all([readFile(path.join(dir, "Inter-Regular.ttf")), readFile(path.join(dir, "Inter-SemiBold.ttf")), readFile(path.join(process.cwd(), "public/logo.png")).catch(() => null)]);
  const font = await pdf.embedFont(reg, { subset: true }), fontB = await pdf.embedFont(bold, { subset: true });
  const logo = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null;
  pdf.setTitle(`Bautagebuch ${p.name}`);
  pdf.setAuthor(COMPANY.name);
  pdf.setCreator("Jarvis ProMont");

  let page!: PDFPage;
  let y = 0;
  let pageNo = 0;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pageNo++;
    y = H - 18 * MM;
    if (logo) {
      const h = 11 * MM, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: RIGHT - w, y: y - h + 4 * MM, width: w, height: h });
    }
    page.drawText("Bautagebuch", { x: LEFT, y, size: 16, font: fontB, color: BRAND });
    y -= 6 * MM;
    page.drawText(safe(font, p.name).slice(0, 90), { x: LEFT, y, size: 10, font, color: INK });
    y -= 4 * MM;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.6, color: LINE });
    y -= 6 * MM;
    page.drawText(`${COMPANY.name} · Seite ${pageNo}`, { x: LEFT, y: 10 * MM, size: 7.5, font, color: STEEL });
  };
  const need = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
  const text = (s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 9.5, f = opts.bold ? fontB : font, x = LEFT + (opts.indent ?? 0);
    for (const line of wrap(safe(f, s), f, size, RIGHT - x)) {
      need(size * 1.45);
      page.drawText(line, { x, y: y - size, size, font: f, color: opts.color ?? INK });
      y -= size * 1.45;
    }
  };
  const field = (label: string, value: string | null) => {
    if (!value) return;
    need(16);
    page.drawText(label, { x: LEFT, y: y - 8.5, size: 8.5, font: fontB, color: STEEL });
    const x = LEFT + 38 * MM;
    for (const line of wrap(safe(font, value), font, 9.5, RIGHT - x)) {
      need(14);
      page.drawText(line, { x, y: y - 9.5, size: 9.5, font, color: INK });
      y -= 13.8;
    }
    y -= 2;
  };

  newPage();
  // Kopf: Projekt, Bauherr, Zeitraum
  const facts: [string, string | null][] = [
    ["Bauvorhaben", p.name],
    ["Baustelle", p.address],
    ["Bauherr/Kunde", p.customerRef?.name ?? p.customer],
    ["Auftragnehmer", `${COMPANY.name}, ${COMPANY.street}, ${COMPANY.zip} ${COMPANY.city}`],
    ["Bauleitung", p.leader?.name ?? null],
    ["Zeitraum", `${formatDate(berlinDateTime(from))} – ${formatDate(berlinDateTime(to))} (${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"})`],
  ];
  page.drawRectangle({ x: LEFT, y: y - facts.filter((f) => f[1]).length * 13.8 - 6, width: RIGHT - LEFT, height: facts.filter((f) => f[1]).length * 13.8 + 6, color: MIST });
  y -= 3;
  for (const [l, v] of facts) field(l, v);
  y -= 8;
  if (!entries.length) text("Im gewählten Zeitraum gibt es keine Einträge.", { color: STEEL });

  for (const e of entries) {
    const crew = readCrew(e.crew);
    const hrs = crew.reduce((s, c) => s + (c.hours ?? 0), 0);
    need(60);
    y -= 4;
    page.drawRectangle({ x: LEFT, y: y - 16, width: RIGHT - LEFT, height: 16, color: BRAND });
    const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(e.day);
    page.drawText(`${weekday}, ${formatDate(e.day)}`, { x: LEFT + 6, y: y - 11.5, size: 10, font: fontB, color: rgb(1, 1, 1) });
    if (e.authorName) {
      const t = safe(font, `erfasst von ${e.authorName}`);
      page.drawText(t, { x: RIGHT - 6 - font.widthOfTextAtSize(t, 8), y: y - 11, size: 8, font, color: rgb(0.9, 0.93, 0.96) });
    }
    y -= 22;
    field("Wetter", e.weather);
    field("Personal", crew.length ? `${crew.map((c) => `${c.name}${c.hours ? ` (${fmtHours(c.hours)})` : ""}`).join(", ")}${hrs ? ` – zusammen ${fmtHours(hrs)}` : ""} · ${crew.length} ${crew.length === 1 ? "Person" : "Personen"}` : null);
    field("Arbeiten", e.work);
    field("Material/Geräte", e.material);
    field("Behinderungen", e.obstacles);
    field("Besucher/Anordn.", e.visitors);
    // Fotos: zwei je Reihe
    const imgs: PDFImage[] = [];
    for (const f of e.files) {
      const img = await (f.mime === "image/png" ? pdf.embedPng(f.data) : pdf.embedJpg(f.data)).catch(() => null);
      if (img) imgs.push(img);
    }
    const colW = (RIGHT - LEFT - 6 * MM) / 2, maxH = 62 * MM;
    for (let k = 0; k < imgs.length; k += 2) {
      const row = imgs.slice(k, k + 2).map((img) => {
        const s = Math.min(colW / img.width, maxH / img.height);
        return { img, w: img.width * s, h: img.height * s };
      });
      const rh = Math.max(...row.map((r) => r.h));
      need(rh + 8);
      row.forEach((r, n) => page.drawImage(r.img, { x: LEFT + n * (colW + 6 * MM), y: y - r.h - 4, width: r.w, height: r.h }));
      y -= rh + 8;
    }
    y -= 4;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.4, color: LINE });
    y -= 6;
  }

  // Unterschriften
  need(40 * MM);
  y -= 22 * MM;
  const half = (RIGHT - LEFT - 12 * MM) / 2;
  for (const [n, label] of [[0, `Bauleitung ${COMPANY.name}`], [1, "Bauherr / Auftraggeber"]] as const) {
    const x = LEFT + n * (half + 12 * MM);
    page.drawLine({ start: { x, y }, end: { x: x + half, y }, thickness: 0.6, color: INK });
    page.drawText(`Datum, Unterschrift ${label}`, { x, y: y - 10, size: 8, font, color: STEEL });
  }
  return { bytes: await pdf.save(), name: `Bautagebuch-${p.name.replace(/[^\wäöüÄÖÜß-]+/g, "-").slice(0, 60)}-${from}_${to}.pdf` };
}

export const diaryDay = ymd;
