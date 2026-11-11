import "server-only";
import { z } from "zod";

// Google Places API (New) – Text Search
// https://developers.google.com/maps/documentation/places/web-service/text-search
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Nur die Felder, die wir brauchen (bestimmen auch die Kosten-SKU)
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "nextPageToken",
].join(",");

/** Normalisierter Treffer – so liegt er in `LeadSearch.results` */
export const placeResultSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  address: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  mapsUrl: z.string().nullable(),
});
export type PlaceResult = z.infer<typeof placeResultSchema>;

const apiPlace = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  addressComponents: z
    .array(z.object({ longText: z.string().optional(), shortText: z.string().optional(), types: z.array(z.string()) }))
    .optional(),
  nationalPhoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  googleMapsUri: z.string().optional(),
  primaryTypeDisplayName: z.object({ text: z.string() }).optional(),
  businessStatus: z.string().optional(),
});

const apiResponse = z.object({
  places: z.array(apiPlace).optional(),
  nextPageToken: z.string().optional(),
});

export class PlacesError extends Error {}

export function placesConfigured() {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

/** Nur lokal: GOOGLE_PLACES_API_KEY=mock liefert Beispieltreffer ohne echte API-Aufrufe */
function isMock() {
  return process.env.GOOGLE_PLACES_API_KEY === "mock" && process.env.NODE_ENV !== "production";
}

export async function searchPlaces(input: {
  query: string;
  location: string;
  pageToken?: string | null;
  /** 89: Umkreis um einen Punkt (nur auf Wunsch, Standort wird nicht gespeichert) */
  bias?: { lat: number; lng: number; radius: number };
}): Promise<{ results: PlaceResult[]; nextPageToken: string | null }> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new PlacesError("GOOGLE_PLACES_API_KEY ist nicht gesetzt.");
  if (isMock()) {
    const { mockSearch } = await import("./places-mock");
    return mockSearch(input.query, input.location, input.pageToken);
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    // Bei Folgeseiten müssen alle Parameter identisch bleiben
    body: JSON.stringify({
      textQuery: input.bias ? input.query : `${input.query} in ${input.location}`,
      ...(input.bias && { locationBias: { circle: { center: { latitude: input.bias.lat, longitude: input.bias.lng }, radius: input.bias.radius } } }),
      languageCode: "de",
      regionCode: "DE",
      pageSize: 20,
      ...(input.pageToken && { pageToken: input.pageToken }),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[places] HTTP ${res.status}: ${body.slice(0, 500)}`);
    if (res.status === 403 || res.status === 401 || (res.status === 400 && /API_KEY_INVALID|API key not valid/.test(body))) {
      throw new PlacesError("Google hat den API-Key abgelehnt (Places API (New) aktiviert? Key-Beschränkungen prüfen).");
    }
    if (res.status === 429) throw new PlacesError("Google-Kontingent erschöpft – bitte später erneut versuchen.");
    throw new PlacesError(`Google Places antwortet mit Fehler ${res.status}.`);
  }

  const data = apiResponse.parse(await res.json());
  const results = (data.places ?? [])
    .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
    .map(normalize);
  return { results, nextPageToken: data.nextPageToken ?? null };
}

function normalize(p: z.infer<typeof apiPlace>): PlaceResult {
  const comp = (type: string) => p.addressComponents?.find((c) => c.types.includes(type))?.longText ?? null;
  const route = comp("route");
  const number = comp("street_number");
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Unbekannt",
    category: p.primaryTypeDisplayName?.text ?? null,
    address: p.formattedAddress ?? null,
    street: route ? [route, number].filter(Boolean).join(" ") : null,
    postalCode: comp("postal_code"),
    city: comp("locality") ?? comp("postal_town"),
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? null,
    mapsUrl: p.googleMapsUri ?? null,
  };
}

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|instagram\.com|tiktok\.com|linktr\.ee|xing\.com|linkedin\.com|business\.site|wa\.me)$/i;

/** Website ist nur ein Social-Media-Profil / Linktree / Google-Baukasten */
export function isSocialOnly(url: string | null): boolean {
  if (!url) return false;
  try {
    return SOCIAL_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Erste Einschätzung beim Übernehmen – der echte Website-Check folgt in Phase 4 */
export function quickCheck(website: string | null): { score: number; issues: string[] } | null {
  if (!website) return { score: 90, issues: ["Keine Website vorhanden – nur Google-Profil"] };
  if (isSocialOnly(website)) return { score: 82, issues: ["Nur Social-Media-Profil statt eigener Website"] };
  return null;
}
