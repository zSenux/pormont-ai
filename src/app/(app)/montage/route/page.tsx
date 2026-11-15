import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, ExternalLink, Flag, MapPin, Navigation, Route as RouteIcon, Truck, Users } from "lucide-react";
import { clsx } from "clsx";
import { requireUser } from "@/lib/auth/user";
import { addDaysYmd, berlinDateTime, todayYmd } from "@/lib/berlin";
import { planRoutes, type Tour } from "@/lib/route";
import { appleNavUrl, fmtKm, fmtMin, type LatLng } from "@/lib/route-shared";

export const metadata = { title: "Routenplanung" };
export const dynamic = "force-dynamic";

const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const dayLabel = (ymd: string) => `${WD[new Date(`${ymd}T12:00:00Z`).getUTCDay()]}, ${new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(berlinDateTime(ymd, "12:00"))}`;

/** Kleine Skizze der Tour (keine Kartendaten, nur Lage der Punkte zueinander) */
function Sketch({ tour }: { tour: Tour }) {
  const pts: LatLng[] = [tour.start, ...tour.stops.map((s) => s.point)].filter(Boolean) as LatLng[];
  if (pts.length < 2) return null;
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLng - minLng) * k, 0.01), h = Math.max(maxLat - minLat, 0.01);
  const s = Math.min(260 / w, 140 / h);
  const xy = (p: LatLng) => [20 + ((p.lng - minLng) * k * s) + (260 - w * s) / 2, 20 + (maxLat - p.lat) * s + (140 - h * s) / 2] as const;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${xy(p)[0].toFixed(1)},${xy(p)[1].toFixed(1)}`).join(" ") + (tour.backMin && tour.start ? ` L${xy(tour.start)[0].toFixed(1)},${xy(tour.start)[1].toFixed(1)}` : "");
  return (
    <svg viewBox="0 0 300 180" className="h-auto w-full rounded-xl bg-mist" role="img" aria-label={`Skizze der Tour ${tour.vehicle}`}>
      <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" />
      {pts.map((p, i) => {
        const [x, y] = xy(p);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={i ? 10 : 11} fill={i ? "var(--color-brand)" : "var(--color-brand-2)"} stroke="white" strokeWidth="2" />
            <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">{i ? i : "W"}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ tag?: string; modus?: string; zurueck?: string; ab?: string; dauer?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayYmd();
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(sp.tag ?? "") ? sp.tag! : today;
  const mode = sp.modus === "zeit" ? "zeit" : "optimal";
  const back = sp.zurueck !== "0";
  const stay = Number(sp.dauer) > 0 ? Math.min(600, Math.round(Number(sp.dauer))) : 90;
  const r = await planRoutes(ymd, { mode, back, depart: sp.ab, stay });
  const q = (p: Record<string, string>) => `/montage/route?${new URLSearchParams({ tag: ymd, modus: mode, zurueck: back ? "1" : "0", ab: r.depart, dauer: String(stay), ...p })}`;

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/montage" className="text-sm text-steel hover:text-brand">← Montage</Link>
          <h1 className="page-title mt-1">Routenplanung</h1>
          <p className="mt-1 text-sm text-steel">Alle Baustellen eines Tages je Fahrzeug als Tour ab der Werkstatt – mit Fahrzeit und Navigation aufs Handy. Oder Jarvis fragen: „Wie fahren wir morgen?“</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={q({ tag: addDaysYmd(ymd, -1) })} className="btn-secondary px-2" aria-label="Vortag"><ChevronLeft className="size-4" /></Link>
          <Link href={q({ tag: today })} className="btn-secondary">Heute</Link>
          <Link href={q({ tag: addDaysYmd(ymd, 1) })} className="btn-secondary px-2" aria-label="Nächster Tag"><ChevronRight className="size-4" /></Link>
        </div>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/montage/route">
        <label className="text-xs text-steel">Tag <input type="date" name="tag" defaultValue={ymd} className="input mt-1 block" /></label>
        <label className="text-xs text-steel">Reihenfolge
          <select name="modus" defaultValue={mode} className="input mt-1 block">
            <option value="optimal">Kürzeste Fahrzeit</option>
            <option value="zeit">Nach geplanter Uhrzeit</option>
          </select>
        </label>
        <label className="text-xs text-steel">Abfahrt <input type="time" name="ab" defaultValue={r.depart} className="input mt-1 block" /></label>
        <label className="text-xs text-steel">Je Baustelle (Min.) <input type="number" name="dauer" min={0} max={600} step={15} defaultValue={stay} className="input mt-1 block w-28" /></label>
        <label className="flex items-center gap-2 pb-2"><input type="hidden" name="zurueck" value="0" /><input type="checkbox" name="zurueck" value="1" defaultChecked={back} className="size-4 accent-brand" /> zurück zur Werkstatt</label>
        <button className="btn-primary">Planen</button>
      </form>

      <p className="flex items-center gap-2 text-sm text-steel"><Flag className="size-4 text-brand" /> {dayLabel(ymd)} · Start: {r.startAddress}{!r.start && <span className="text-bad"> (Adresse nicht gefunden)</span>}</p>

      {!r.count && (
        <section className="card p-8 text-center text-steel">
          <RouteIcon className="mx-auto size-8 text-brand" />
          <p className="mt-2">An diesem Tag sind keine Montagen oder Termine mit Adresse geplant.</p>
        </section>
      )}

      {r.tours.map((t) => (
        <section key={t.vehicle} className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Truck className="size-5 text-brand" /> {t.vehicle}</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="chip bg-brand-soft text-brand-2"><Clock className="size-3.5" /> {fmtMin(t.totalMin)} Fahrt</span>
              <span className="chip bg-white text-steel">{fmtKm(t.totalKm)}</span>
              <span className="chip bg-white text-steel">{t.stops.length} {t.stops.length === 1 ? "Stopp" : "Stopps"}</span>
              {t.estimated && <span className="chip border-warn/30 bg-amber-50 text-warn" title="Kein Routing-Dienst erreichbar – Schätzung aus der Luftlinie">geschätzt</span>}
            </div>
          </div>
          {t.reordered && mode === "optimal" && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Die kürzeste Reihenfolge weicht von den geplanten Uhrzeiten ab. Ggf. Termine anpassen oder <Link href={q({ modus: "zeit" })} className="underline">nach Uhrzeit fahren</Link>.</span></p>
          )}
          <div className="grid gap-5 md:grid-cols-[1fr_18rem]">
            <ol className="relative space-y-0">
              <li className="flex items-center gap-3 pb-2 text-sm">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-2 text-xs font-bold text-white">W</span>
                <span><strong>{r.depart}</strong> Abfahrt Werkstatt</span>
              </li>
              {t.stops.map((s, i) => (
                <li key={s.id}>
                  <p className="ml-4 border-l-2 border-dashed border-brand/30 py-1.5 pl-6 text-xs text-steel">↓ {fmtMin(s.driveMin)} · {fmtKm(s.driveKm)}</p>
                  <div className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1 rounded-xl border border-line p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold"><span className="text-brand">{s.eta}</span> · <Link href={s.href} className="hover:underline">{s.number ? `${s.number} · ` : ""}{s.title}</Link></p>
                          {s.project && <p className="text-xs text-steel">{s.project}</p>}
                          <p className="mt-1 flex items-center gap-1 text-sm"><MapPin className="size-3.5 shrink-0 text-steel" /> {s.address}</p>
                          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-steel">
                            {!s.allDay && <span>geplant {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(s.startAt)} Uhr</span>}
                            {s.crew.length > 0 && <span className="flex items-center gap-1"><Users className="size-3" /> {s.crew.join(", ")}</span>}
                            {s.kind === "termin" && <span>Kalender-Termin</span>}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <a href={s.nav} target="_blank" rel="noopener noreferrer" className="btn-primary px-3 py-1.5 text-xs"><Navigation className="size-3.5" /> Navi</a>
                          <a href={appleNavUrl(s.address)} target="_blank" rel="noopener noreferrer" className="btn-secondary px-3 py-1.5 text-xs">Apple</a>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {back && t.backMin > 0 && (
                <li>
                  <p className="ml-4 border-l-2 border-dashed border-brand/30 py-1.5 pl-6 text-xs text-steel">↓ {fmtMin(t.backMin)} · {fmtKm(t.backKm)}</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-2 text-xs font-bold text-white">W</span>
                    <span>Zurück in der Werkstatt</span>
                  </div>
                </li>
              )}
            </ol>
            <div className="space-y-3">
              <Sketch tour={t} />
              {t.mapsUrl && (
                <a href={t.mapsUrl} target="_blank" rel="noopener noreferrer" className={clsx("btn-primary w-full justify-center")}><ExternalLink className="size-4" /> Ganze Tour in Google Maps</a>
              )}
              <p className="text-xs text-steel">Auf dem Handy öffnet sich die Navigation direkt. Fahrzeiten ohne Verkehrslage{t.estimated ? ", hier nur aus der Luftlinie geschätzt" : " (OpenStreetMap)"}.</p>
            </div>
          </div>
          {t.missing.length > 0 && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-bad">
              <p className="font-medium">Adresse nicht gefunden – nicht in der Tour:</p>
              <ul className="mt-1 list-disc pl-5">{t.missing.map((s) => <li key={s.id}><Link href={s.href} className="underline">{s.title}</Link>: {s.address}</li>)}</ul>
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
