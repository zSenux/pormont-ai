import "server-only";
import { db } from "@/lib/db";
import { addDaysYmd, berlinDateTime, berlinParts, formatDate } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { bestOrder, estimateLeg, fmtKm, fmtMin, googleNavUrl, googleTourUrl, type LatLng } from "@/lib/route-shared";

// Routenplanung für Montagen: alle Baustellen eines Tages je Fahrzeug als Tour ab der Werkstatt.
// Adressen → Koordinaten über OpenStreetMap (Nominatim, gecacht in GeoPoint), Fahrzeiten über OSRM
// (OSRM_URL, Standard: öffentlicher Server). Ohne Netz/Dienst: Schätzung aus der Luftlinie.
// Nur lesen – Termine werden nicht verschoben; die Navigation läuft über Google Maps/Apple Karten auf dem Handy.

const UA = "Jarvis-ProMont/1.0 (Routenplanung Montage)";
export const routeStart = () => process.env.ROUTE_START?.trim() || `${COMPANY.street}, ${COMPANY.zip} ${COMPANY.city}`;
const offline = () => process.env.ROUTE_OFFLINE === "1";

const keyOf = (address: string) => address.toLowerCase().replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();

let lastGeo = 0;
/** Adresse → Koordinaten (Cache; Fehlversuche werden nach einem Tag neu versucht) */
export async function geocode(address: string): Promise<LatLng | null> {
  const key = keyOf(address);
  if (!key) return null;
  const hit = await db.geoPoint.findUnique({ where: { key } });
  if (hit?.lat != null && hit.lng != null) return { lat: hit.lat, lng: hit.lng };
  if (hit && Date.now() - hit.createdAt.getTime() < 86400_000) return null;
  if (offline()) return null;
  // Nominatim: höchstens 1 Anfrage pro Sekunde
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  let p: LatLng | null = null;
  try {
    const url = `${process.env.GEOCODER_URL?.replace(/\/$/, "") || "https://nominatim.openstreetmap.org"}/search?format=jsonv2&limit=1&countrycodes=de&accept-language=de&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = (await res.json()) as { lat: string; lon: string }[];
      if (j[0]) p = { lat: Number(j[0].lat), lng: Number(j[0].lon) };
    }
  } catch {
    // Netzwerkfehler → kein Cache-Eintrag, beim nächsten Mal neu versuchen
    return null;
  }
  await db.geoPoint.upsert({ where: { key }, create: { key, address, lat: p?.lat ?? null, lng: p?.lng ?? null, source: p ? "osm" : "fehler" }, update: { lat: p?.lat ?? null, lng: p?.lng ?? null, source: p ? "osm" : "fehler", createdAt: new Date() } });
  return p;
}

/** Fahrzeit-Matrix in Minuten + km. OSRM, sonst Schätzung aus der Luftlinie (estimated = true). */
async function matrix(points: LatLng[]): Promise<{ min: number[][]; km: number[][]; estimated: boolean }> {
  if (!offline() && points.length >= 2 && points.length <= 25) {
    try {
      const base = process.env.OSRM_URL?.replace(/\/$/, "") || "https://router.project-osrm.org";
      const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
      const res = await fetch(`${base}/table/v1/driving/${coords}?annotations=duration,distance`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const j = (await res.json()) as { code: string; durations: (number | null)[][]; distances: (number | null)[][] };
        if (j.code === "Ok" && j.durations.every((r) => r.every((x) => x !== null))) {
          return { min: j.durations.map((r) => r.map((s) => (s ?? 0) / 60)), km: j.distances.map((r) => r.map((m) => (m ?? 0) / 1000)), estimated: false };
        }
      }
    } catch {}
  }
  const legs = points.map((a) => points.map((b) => estimateLeg(a, b)));
  return { min: legs.map((r) => r.map((l) => l.min)), km: legs.map((r) => r.map((l) => l.km)), estimated: true };
}

export type Stop = {
  id: string;
  kind: "montage" | "termin";
  number: string | null;
  title: string;
  project: string | null;
  address: string;
  startAt: Date;
  allDay: boolean;
  status: string | null;
  crew: string[];
  href: string;
  point: LatLng | null;
};

export type Tour = {
  vehicle: string;
  stops: (Stop & { driveMin: number; driveKm: number; eta: string; nav: string })[];
  backMin: number;
  backKm: number;
  totalMin: number;
  totalKm: number;
  estimated: boolean;
  /** Reihenfolge nach Fahrzeit weicht von den geplanten Uhrzeiten ab */
  reordered: boolean;
  missing: Stop[];
  mapsUrl: string | null;
  start: LatLng | null;
};

const hm = (d: Date) => {
  const p = berlinParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};
const addMin = (t: string, min: number) => {
  const [h, m] = t.split(":").map(Number);
  const x = Math.round(h * 60 + m + min);
  return `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

/** Montagen (und Kalender-Termine mit Ort) an einem Tag */
export async function stopsOf(ymd: string): Promise<Stop[]> {
  const from = berlinDateTime(ymd), to = berlinDateTime(addDaysYmd(ymd, 1));
  const [asm, events] = await Promise.all([
    db.assembly.findMany({
      where: { status: { in: ["GEPLANT", "LAEUFT"] }, startAt: { lt: to }, OR: [{ endAt: { gte: from } }, { endAt: null, startAt: { gte: from } }] },
      orderBy: { startAt: "asc" },
      include: { project: { select: { name: true, address: true } }, leader: { select: { name: true } }, crew: { include: { user: { select: { name: true } } } } },
    }),
    db.event.findMany({ where: { startAt: { gte: from, lt: to }, location: { not: null } }, orderBy: { startAt: "asc" }, include: { project: { select: { name: true } } } }),
  ]);
  const linked = new Set(asm.map((a) => a.eventId).filter(Boolean));
  const stops: Stop[] = [];
  for (const a of asm) {
    const address = a.address || a.project.address;
    if (!address) continue;
    const crew = [...new Set([a.leader?.name, ...a.crew.map((c) => c.user.name)].filter(Boolean) as string[])];
    // Mehrtägige Montage: an Folgetagen ab Arbeitsbeginn 7:00
    const startAt = a.startAt < from ? berlinDateTime(ymd, "07:00") : a.startAt;
    stops.push({ id: a.id, kind: "montage", number: a.number, title: a.title, project: a.project.name, address, startAt, allDay: false, status: a.status, crew, href: `/montage/${a.id}`, point: null });
  }
  for (const e of events) {
    if (linked.has(e.id) || !e.location?.trim()) continue;
    stops.push({ id: e.id, kind: "termin", number: null, title: e.title, project: e.project?.name ?? null, address: e.location, startAt: e.startAt, allDay: e.allDay, status: null, crew: [], href: "/kalender", point: null });
  }
  for (const s of stops) s.point = await geocode(s.address);
  return stops;
}

/**
 * Touren eines Tages: je Fahrzeug eine Tour (Termine ohne Fahrzeug zusammen).
 * modus „optimal“ = kürzeste Fahrzeit, „zeit“ = nach geplanter Uhrzeit. stay = Aufenthalt je Stopp in Minuten.
 */
export async function planRoutes(ymd: string, opts: { mode?: "optimal" | "zeit"; back?: boolean; depart?: string; stay?: number } = {}) {
  const mode = opts.mode ?? "optimal";
  const back = opts.back ?? true;
  const depart = /^\d{2}:\d{2}$/.test(opts.depart ?? "") ? opts.depart! : "07:00";
  const stay = Math.max(0, Math.min(600, opts.stay ?? 90));
  const startAddress = routeStart();
  const [start, stops] = await Promise.all([geocode(startAddress), stopsOf(ymd)]);
  const asmIds = stops.filter((s) => s.kind === "montage").map((s) => s.id);
  const vehicles = new Map((await db.assembly.findMany({ where: { id: { in: asmIds } }, select: { id: true, vehicle: true } })).map((a) => [a.id, a.vehicle?.trim() || null]));
  const groups = new Map<string, Stop[]>();
  for (const s of stops) {
    const v = (s.kind === "montage" && vehicles.get(s.id)) || "Ohne Fahrzeug";
    groups.set(v, [...(groups.get(v) ?? []), s]);
  }
  const tours: Tour[] = [];
  for (const [vehicle, list] of [...groups].sort((a, b) => (a[0] === "Ohne Fahrzeug" ? 1 : b[0] === "Ohne Fahrzeug" ? -1 : a[0].localeCompare(b[0], "de")))) {
    const located = list.filter((s) => s.point);
    const missing = list.filter((s) => !s.point);
    const byTime = [...located].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    let ordered = byTime;
    let mins: number[][] = [], kms: number[][] = [], estimated = true;
    if (start && located.length) {
      const pts = [start, ...byTime.map((s) => s.point!)];
      const mx = await matrix(pts);
      (mins = mx.min), (kms = mx.km), (estimated = mx.estimated);
      if (mode === "optimal") ordered = bestOrder(mins, back).map((i) => byTime[i - 1]);
    }
    const idx = (s: Stop) => byTime.indexOf(s) + 1;
    let prev = 0, clock = depart, totalMin = 0, totalKm = 0;
    const out: Tour["stops"] = [];
    for (const s of ordered) {
      const i = idx(s);
      const driveMin = mins.length ? mins[prev][i] : 0;
      const driveKm = kms.length ? kms[prev][i] : 0;
      clock = addMin(clock, driveMin);
      // Fester Termin später als die Ankunft → warten bis dahin
      const planned = s.allDay ? null : hm(s.startAt);
      const eta = clock;
      if (planned && planned > clock && mode === "zeit") clock = planned;
      out.push({ ...s, driveMin, driveKm, eta, nav: googleNavUrl(s.address) });
      clock = addMin(clock, stay);
      (totalMin += driveMin), (totalKm += driveKm), (prev = i);
    }
    const backMin = back && mins.length && prev ? mins[prev][0] : 0;
    const backKm = back && kms.length && prev ? kms[prev][0] : 0;
    tours.push({
      vehicle,
      stops: out,
      backMin,
      backKm,
      totalMin: totalMin + backMin,
      totalKm: totalKm + backKm,
      estimated,
      reordered: ordered.some((s, i) => s !== byTime[i]),
      missing,
      mapsUrl: googleTourUrl(startAddress, out.map((s) => s.address), back),
      start,
    });
  }
  return { ymd, startAddress, start, depart, stay, back, mode, tours, count: stops.length };
}

/** Kurztext für Jarvis */
export function routeText(r: Awaited<ReturnType<typeof planRoutes>>) {
  if (!r.count) return `Am ${formatDate(berlinDateTime(r.ymd))} sind keine Montagen oder Termine mit Adresse geplant. [Montage](/montage)`;
  const parts = [`Touren am ${formatDate(berlinDateTime(r.ymd))} ab ${r.startAddress} (Abfahrt ${r.depart}, ${r.stay} Min. je Baustelle, ${r.mode === "optimal" ? "kürzeste Reihenfolge" : "nach Uhrzeit"}):`];
  for (const t of r.tours) {
    parts.push(`\n**${t.vehicle}** – ${t.stops.length} Stopps, Fahrzeit ${fmtMin(t.totalMin)}, ${fmtKm(t.totalKm)}${t.estimated ? " (geschätzt)" : ""}${t.reordered ? " – Reihenfolge weicht von den geplanten Uhrzeiten ab" : ""}`);
    t.stops.forEach((s, i) => parts.push(`${i + 1}. ${s.eta} ${s.number ? `${s.number} ` : ""}${s.title} – ${s.address} (${fmtMin(s.driveMin)} Fahrt)${s.crew.length ? ` · ${s.crew.join(", ")}` : ""}`));
    if (t.backMin) parts.push(`Rückfahrt Werkstatt: ${fmtMin(t.backMin)}`);
    if (t.missing.length) parts.push(`Adresse nicht gefunden: ${t.missing.map((s) => `${s.title} (${s.address})`).join("; ")}`);
    if (t.mapsUrl) parts.push(`[Tour in Google Maps](${t.mapsUrl})`);
  }
  parts.push(`[Routenplanung](/montage/route?tag=${r.ymd})`);
  return parts.join("\n");
}
