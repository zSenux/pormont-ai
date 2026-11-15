// Routenplanung – gemeinsam für Server und Browser: Navigations-Links, Luftlinie, beste Reihenfolge.

export type LatLng = { lat: number; lng: number };

const enc = (s: string) => encodeURIComponent(s.replace(/\s+/g, " ").trim());

/** Ganze Tour in Google Maps (öffnet auf dem iPhone/Android die Maps-App, sonst den Browser) */
export function googleTourUrl(start: string, stops: string[], back: boolean) {
  if (!stops.length) return null;
  const dest = back ? start : stops[stops.length - 1];
  const via = back ? stops : stops.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&origin=${enc(start)}&destination=${enc(dest)}${via.length ? `&waypoints=${via.map(enc).join("%7C")}` : ""}&travelmode=driving`;
}

/** Navigation zu einem Ziel vom aktuellen Standort */
export const googleNavUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${enc(address)}&travelmode=driving`;
export const appleNavUrl = (address: string) => `https://maps.apple.com/?daddr=${enc(address)}&dirflg=d`;

/** Luftlinie in km */
export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Schätzung ohne Routing-Dienst: Straße ≈ 1,3 × Luftlinie, im Schnitt 45 km/h, + 5 Min. für Parken/Rangieren */
export function estimateLeg(a: LatLng, b: LatLng) {
  const km = haversineKm(a, b) * 1.3;
  return { km, min: km < 0.2 ? 0 : (km / 45) * 60 + 5 };
}

/**
 * Beste Reihenfolge der Stopps 1..n-1 ab Punkt 0 (Werkstatt) nach Fahrzeit-Matrix.
 * back = Rückfahrt zur Werkstatt zählt mit. Bis 8 Stopps exakt (alle Reihenfolgen), darüber nächster Nachbar + 2-opt.
 */
export function bestOrder(m: number[][], back: boolean): number[] {
  const n = m.length;
  const stops = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const cost = (order: number[]) => {
    let c = 0, prev = 0;
    for (const s of order) (c += m[prev][s]), (prev = s);
    return back ? c + m[prev][0] : c;
  };
  if (stops.length <= 1) return stops;
  if (stops.length <= 8) {
    let best = stops, bestC = Infinity;
    const perm = (rest: number[], acc: number[]) => {
      if (!rest.length) {
        const c = cost(acc);
        if (c < bestC) (bestC = c), (best = acc);
        return;
      }
      for (let i = 0; i < rest.length; i++) perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    };
    perm(stops, []);
    return best;
  }
  // Nächster Nachbar
  const order: number[] = [];
  const left = new Set(stops);
  let cur = 0;
  while (left.size) {
    let nxt = -1, d = Infinity;
    for (const s of left) if (m[cur][s] < d) (d = m[cur][s]), (nxt = s);
    order.push(nxt);
    left.delete(nxt);
    cur = nxt;
  }
  // 2-opt verbessern
  let improved = true, c0 = cost(order);
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++)
      for (let k = i + 1; k < order.length; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c = cost(cand);
        if (c + 0.01 < c0) (order.splice(0, order.length, ...cand), (c0 = c), (improved = true));
      }
  }
  return order;
}

export const fmtMin = (min: number) => {
  const m = Math.round(min);
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${String(m % 60).padStart(2, "0")} Min.`;
};
export const fmtKm = (km: number) => `${km.toLocaleString("de-DE", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
