import "server-only";
import type { PlaceResult } from "./places";

// Nur für lokale Tests (GOOGLE_PLACES_API_KEY=mock): erzeugt plausible Treffer ohne API-Aufruf.
const STREETS = ["Hauptstraße", "Bahnhofstraße", "Breite Straße", "Kaiserring", "Seckenheimer Straße", "Mittelstraße", "Schwetzinger Straße"];
const PREFIXES = ["Studio", "Meister", "Team", "Atelier", "Haus", "Werkstatt"];
const SUFFIXES = ["Müller", "Schmidt", "am Ring", "Nord", "Wagner", "& Söhne", "Rhein-Neckar", "City", "Becker", "Lindenhof"];

export function mockSearch(query: string, location: string, pageToken?: string | null) {
  const page = pageToken ? Number(pageToken) : 0;
  const results: PlaceResult[] = Array.from({ length: page < 2 ? 20 : 11 }, (_, i) => {
    const n = page * 20 + i;
    const website = n % 3 === 0 ? null : n % 7 === 0 ? `https://instagram.com/${slug(query)}${n}` : `https://www.${slug(query)}-${n}.de`;
    return {
      placeId: `mock-${slug(query)}-${slug(location)}-${n}`,
      name: `${PREFIXES[n % PREFIXES.length]} ${query} ${SUFFIXES[n % SUFFIXES.length]}`,
      category: query,
      address: `${STREETS[n % STREETS.length]} ${n + 1}, 68161 ${location}, Deutschland`,
      street: `${STREETS[n % STREETS.length]} ${n + 1}`,
      postalCode: "68161",
      city: location,
      phone: `0621 ${String(4000000 + n * 7919).slice(0, 7)}`,
      website,
      rating: Math.round((3.6 + ((n * 37) % 14) / 10) * 10) / 10,
      reviews: 5 + ((n * 53) % 400),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${query} ${location} ${n}`)}`,
    };
  });
  return { results, nextPageToken: page < 2 ? String(page + 1) : null };
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
