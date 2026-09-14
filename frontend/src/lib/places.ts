import { GROUP_SEEDS } from "../data/fixtures";
import neighborhoodData from "../data/fremont-neighborhoods.json";
import { haversineKm, pointInPolygon } from "./geo";
import type { LngLat } from "./types";

// Places page: the areas people can explore and the place categories they can filter by.
// Places themselves come live from Google Places (see components/places/PlacesExplorer).

export interface Area {
  slug: string;
  name: string;
  /** Outer ring as [lng, lat]; null for the whole city. */
  polygon: LngLat[] | null;
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  /** Radius around `center` that covers the whole area, for Google's circular nearby search. */
  radiusM: number;
}

export interface PlaceCategory {
  id: string;
  label: string;
  icon: string;
  /** Pin and chip accent. */
  color: string;
  /** Google Places (New) Table A types. Empty means "popular places of any kind". */
  types: string[];
}

export const CATEGORIES: PlaceCategory[] = [
  { id: "top", label: "Popular", icon: "⭐", color: "#262626", types: [] },
  { id: "restaurants", label: "Restaurants", icon: "🍽️", color: "#c2410c", types: ["restaurant", "fast_food_restaurant", "meal_takeaway"] },
  { id: "cafes", label: "Cafés & bakeries", icon: "☕", color: "#92400e", types: ["cafe", "coffee_shop", "bakery", "dessert_shop", "ice_cream_shop"] },
  { id: "schools", label: "Schools", icon: "🎓", color: "#1d4ed8", types: ["primary_school", "secondary_school", "school", "preschool", "university"] },
  { id: "salons", label: "Salons & barbers", icon: "💇", color: "#be185d", types: ["hair_salon", "beauty_salon", "nail_salon", "barber_shop", "spa"] },
  { id: "groceries", label: "Groceries", icon: "🛒", color: "#15803d", types: ["grocery_store", "supermarket", "market", "convenience_store"] },
  { id: "parks", label: "Parks", icon: "🌳", color: "#2f6a31", types: ["park", "playground", "dog_park", "hiking_area"] },
  { id: "health", label: "Health", icon: "🩺", color: "#b91c1c", types: ["pharmacy", "drugstore", "hospital", "doctor", "dentist"] },
  { id: "fitness", label: "Fitness", icon: "🏋️", color: "#6d28d9", types: ["gym", "fitness_center"] },
  { id: "community", label: "Libraries & community", icon: "📚", color: "#0e7490", types: ["library", "community_center"] },
  { id: "worship", label: "Places of worship", icon: "🙏", color: "#7c2d12", types: ["church", "hindu_temple", "mosque", "synagogue"] },
  { id: "civic", label: "City services", icon: "🏛️", color: "#334155", types: ["city_hall", "post_office", "police", "fire_station", "local_government_office", "courthouse"] },
  { id: "banks", label: "Banks & ATMs", icon: "🏦", color: "#0f766e", types: ["bank", "atm"] },
  { id: "transit", label: "Transit", icon: "🚆", color: "#4338ca", types: ["train_station", "transit_station", "bus_station"] },
  { id: "fuel", label: "Gas & EV charging", icon: "⛽", color: "#a16207", types: ["gas_station", "electric_vehicle_charging_station"] },
];

const DEFAULT_CATEGORY = CATEGORIES[0];

export const categoryById = (id: string): PlaceCategory => CATEGORIES.find((c) => c.id === id) ?? DEFAULT_CATEGORY;

/** The category a Google place type belongs to, for picking a pin icon. */
export const categoryForType = (type: string | null | undefined): PlaceCategory | undefined =>
  type ? CATEGORIES.find((c) => c.types.includes(type)) : undefined;

const MAX_NEARBY_RADIUS_M = 50_000;

function boundsOf(rings: LngLat[][]): Area["bounds"] {
  const points = rings.flat();
  return {
    north: Math.max(...points.map(([, lat]) => lat)),
    south: Math.min(...points.map(([, lat]) => lat)),
    east: Math.max(...points.map(([lng]) => lng)),
    west: Math.min(...points.map(([lng]) => lng)),
  };
}

function areaFrom(slug: string, name: string, rings: LngLat[][], polygon: LngLat[] | null): Area {
  const bounds = boundsOf(rings);
  const center = { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 };
  const farthestKm = Math.max(...rings.flat().map((p) => haversineKm([center.lng, center.lat], p)));
  // A little slack so places on the boundary line are still returned.
  const radiusM = Math.min(MAX_NEARBY_RADIUS_M, Math.ceil(farthestKm * 1000) + 150);
  return { slug, name, polygon, center, bounds, radiusM };
}

export const NEIGHBORHOODS: Area[] = (neighborhoodData as { slug: string; name: string; polygon: unknown }[])
  .map((n) => {
    const ring = n.polygon as LngLat[];
    return areaFrom(n.slug, n.name, [ring], ring);
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const FREMONT: Area = areaFrom(
  "fremont",
  "All of Fremont",
  NEIGHBORHOODS.map((n) => n.polygon as LngLat[]),
  null,
);

const BY_SLUG = new Map(NEIGHBORHOODS.map((n) => [n.slug, n]));

export const areaBySlug = (slug: string | null | undefined): Area | undefined =>
  slug === FREMONT.slug ? FREMONT : slug ? BY_SLUG.get(slug) : undefined;

/** The Fremont neighborhood containing a point, if any. */
export const neighborhoodAt = (lng: number, lat: number): Area | undefined =>
  NEIGHBORHOODS.find((n) => n.polygon && pointInPolygon([lng, lat], n.polygon));

/** A Google opening-hours point: day 0 is Sunday. */
export interface HoursPoint {
  day: number;
  hour: number;
  minute: number;
}

const WEEK_MINUTES = 7 * 24 * 60;
const weekMinute = (p: HoursPoint) => p.day * 24 * 60 + p.hour * 60 + p.minute;

/**
 * Whether a place is open at `now`, from its regular opening periods and UTC offset.
 * Place.isOpen() is beta-only in the Maps JavaScript API, so this does the same math:
 * a period with no close is open around the clock, and periods may cross midnight or the week end.
 * Returns undefined when there isn't enough data to say.
 */
export function isOpenAt(
  periods: { open: HoursPoint; close?: HoursPoint | null }[] | null | undefined,
  utcOffsetMinutes: number | null | undefined,
  now: Date = new Date(),
): boolean | undefined {
  if (!periods?.length || typeof utcOffsetMinutes !== "number") return undefined;
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const t = local.getUTCDay() * 24 * 60 + local.getUTCHours() * 60 + local.getUTCMinutes();
  return periods.some(({ open, close }) => {
    if (!close) return true;
    const start = weekMinute(open);
    let end = weekMinute(close);
    if (end <= start) end += WEEK_MINUTES;
    return (t >= start && t < end) || (t + WEEK_MINUTES >= start && t + WEEK_MINUTES < end);
  });
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A member's home neighborhood: the one their first group is in. */
export function neighborhoodForGroups(groupSlugs: string[]): Area | undefined {
  for (const slug of groupSlugs) {
    // A group's slug is its neighborhood's; old sessions may still carry a prototype sample group slug.
    const seed = GROUP_SEEDS.find((g) => g.slug === slug);
    const area = BY_SLUG.get(seed ? slugOf(seed.district) : slug);
    if (area) return area;
  }
  return undefined;
}
