import { describe, expect, it } from "vitest";
import { GROUP_SEEDS } from "../data/fixtures";
import { haversineKm, pointInPolygon } from "./geo";
import {
  areaBySlug,
  CATEGORIES,
  categoryById,
  categoryForType,
  FREMONT,
  isOpenAt,
  neighborhoodAt,
  neighborhoodForGroups,
  NEIGHBORHOODS,
} from "./places";

describe("isOpenAt", () => {
  const PDT = -420;
  // Sunday 2026-09-13 at 14:30 in Fremont (PDT) is 21:30 UTC.
  const sundayAfternoon = new Date("2026-09-13T21:30:00Z");
  const at = (day: number, hour: number, minute = 0) => ({ day, hour, minute });

  it("reads regular daily hours in the place's own time zone", () => {
    const weekdays9to5 = [1, 2, 3, 4, 5].map((d) => ({ open: at(d, 9), close: at(d, 17) }));
    expect(isOpenAt(weekdays9to5, PDT, sundayAfternoon)).toBe(false);
    expect(isOpenAt(weekdays9to5, PDT, new Date("2026-09-14T16:05:00Z"))).toBe(true); // Monday 09:05 PDT
    expect(isOpenAt(weekdays9to5, PDT, new Date("2026-09-15T00:00:00Z"))).toBe(false); // Monday 17:00 PDT, just closed
    expect(isOpenAt([{ open: at(0, 11), close: at(0, 21) }], PDT, sundayAfternoon)).toBe(true);
  });

  it("handles 24-hour places, overnight hours and the Saturday-to-Sunday wrap", () => {
    expect(isOpenAt([{ open: at(0, 0), close: null }], PDT, sundayAfternoon)).toBe(true);
    const lateNight = [{ open: at(6, 18), close: at(0, 2) }]; // Saturday 18:00 to Sunday 02:00
    expect(isOpenAt(lateNight, PDT, new Date("2026-09-13T08:30:00Z"))).toBe(true); // Sunday 01:30 PDT
    expect(isOpenAt(lateNight, PDT, new Date("2026-09-13T10:00:00Z"))).toBe(false); // Sunday 03:00 PDT
    expect(isOpenAt([{ open: at(5, 22), close: at(6, 3) }], PDT, new Date("2026-09-12T08:00:00Z"))).toBe(true); // Saturday 01:00 PDT
  });

  it("returns undefined without hours or an offset", () => {
    expect(isOpenAt([], PDT, sundayAfternoon)).toBeUndefined();
    expect(isOpenAt(null, PDT, sundayAfternoon)).toBeUndefined();
    expect(isOpenAt([{ open: at(0, 9), close: at(0, 17) }], undefined, sundayAfternoon)).toBeUndefined();
  });
});

// Checked against Google's Places API (New) Table A on 2026-09-13. Table B types (like place_of_worship)
// are rejected as search filters, so every category type must come from this list.
const TABLE_A = new Set([
  "restaurant", "fast_food_restaurant", "meal_takeaway", "cafe", "coffee_shop", "bakery", "dessert_shop", "ice_cream_shop",
  "primary_school", "secondary_school", "school", "preschool", "university", "hair_salon", "beauty_salon", "nail_salon",
  "barber_shop", "spa", "grocery_store", "supermarket", "market", "convenience_store", "park", "playground", "dog_park",
  "hiking_area", "pharmacy", "drugstore", "hospital", "doctor", "dentist", "gym", "fitness_center", "library",
  "community_center", "church", "hindu_temple", "mosque", "synagogue", "city_hall", "post_office", "police", "fire_station",
  "local_government_office", "courthouse", "bank", "atm", "train_station", "transit_station", "bus_station", "gas_station",
  "electric_vehicle_charging_station",
]);

describe("place categories", () => {
  it("use unique ids and only valid Google search types", () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const category of CATEGORIES) for (const type of category.types) expect(TABLE_A.has(type), `${category.id}: ${type}`).toBe(true);
    expect(categoryById("nope").id).toBe("top");
    expect(categoryForType("nail_salon")?.id).toBe("salons");
    expect(categoryForType("primary_school")?.id).toBe("schools");
  });
});

describe("neighborhood areas", () => {
  it("covers all 32 Fremont neighborhoods with a search circle that reaches every boundary point", () => {
    expect(NEIGHBORHOODS).toHaveLength(32);
    for (const area of [...NEIGHBORHOODS, FREMONT]) {
      expect(area.radiusM).toBeLessThanOrEqual(50_000);
      const rings = area.polygon ? [area.polygon] : NEIGHBORHOODS.map((n) => n.polygon ?? []);
      for (const point of rings.flat()) {
        expect(haversineKm([area.center.lng, area.center.lat], point) * 1000).toBeLessThanOrEqual(area.radiusM);
      }
    }
  });

  it("finds the neighborhood for a point, and nothing outside Fremont", () => {
    expect(areaBySlug("niles")?.name).toBe("Niles");
    // Stored centroids of Niles and Irvington.
    expect(pointInPolygon([-121.981888, 37.585525], areaBySlug("niles")?.polygon ?? [])).toBe(true);
    expect(neighborhoodAt(-121.981888, 37.585525)?.slug).toBe("niles");
    expect(neighborhoodAt(-121.960486, 37.531095)?.slug).toBe("irvington");
    expect(neighborhoodAt(-122.4194, 37.7749)).toBeUndefined(); // San Francisco
    expect(areaBySlug("fremont")).toBe(FREMONT);
    expect(areaBySlug("atlantis")).toBeUndefined();
  });

  it("places every Pacific Commons boundary inside the city bounds, even without a stored centroid", () => {
    const pacific = areaBySlug("pacific-commons-auto-mall");
    expect(pacific).toBeDefined();
    expect(Number.isFinite(pacific?.center.lat)).toBe(true);
    expect(pacific!.bounds.north).toBeLessThanOrEqual(FREMONT.bounds.north);
    expect(pacific!.bounds.west).toBeGreaterThanOrEqual(FREMONT.bounds.west);
  });

  it("maps every sample group to its home neighborhood", () => {
    for (const group of GROUP_SEEDS) expect(neighborhoodForGroups([group.slug]), group.slug).toBeDefined();
    expect(neighborhoodForGroups(["niles-neighbors"])?.slug).toBe("niles");
    expect(neighborhoodForGroups(["unknown", "irvington-commons"])?.slug).toBe("irvington");
    expect(neighborhoodForGroups([])).toBeUndefined();
  });
});
