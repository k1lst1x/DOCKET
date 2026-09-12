import type { GeocodedPoint } from "./types";

// Generous box around Fremont city limits; anything outside is another city.
const FREMONT_BOUNDS = { minLat: 37.45, maxLat: 37.64, minLng: -122.1, maxLng: -121.85 };

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodeOutcome =
  | { ok: true; point: GeocodedPoint }
  | { ok: false; reason: "not_found" | "outside_city" | "unavailable" };

interface CensusResponse {
  result?: {
    addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[];
  };
}

export function normalizeAddress(raw: string): string {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!q) return "";
  return /\bfremont\b/i.test(q) ? q : `${q}, Fremont, CA`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "37600 NILES BLVD, FREMONT, CA, 94536" -> "37600 Niles Blvd, Fremont, CA 94536" */
function tidyMatchedAddress(raw: string): string {
  const [street, city, state, zip] = raw.split(",").map((p) => p.trim());
  if (!city || !state) return titleCase(raw);
  return `${titleCase(street)}, ${titleCase(city)}, ${state}${zip ? ` ${zip}` : ""}`;
}

/** US Census geocoder: free, keyless, and good for US street addresses. */
export async function geocode(raw: string): Promise<GeocodeOutcome> {
  const address = normalizeAddress(raw);
  if (!address) return { ok: false, reason: "not_found" };

  const url = new URL(CENSUS_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  let data: CensusResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    data = (await res.json()) as CensusResponse;
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const match = data.result?.addressMatches?.[0];
  if (!match) return { ok: false, reason: "not_found" };

  const { x: lng, y: lat } = match.coordinates;
  const inFremont =
    lat >= FREMONT_BOUNDS.minLat && lat <= FREMONT_BOUNDS.maxLat && lng >= FREMONT_BOUNDS.minLng && lng <= FREMONT_BOUNDS.maxLng;
  if (!inFremont) return { ok: false, reason: "outside_city" };

  return { ok: true, point: { lat, lng, matchedAddress: tidyMatchedAddress(match.matchedAddress) } };
}
