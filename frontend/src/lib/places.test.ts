import { describe, expect, it } from "vitest";
import { GROUP_SEEDS } from "../data/fixtures";
import { haversineKm, pointInPolygon } from "./geo";
import { areaBySlug, CATEGORIES, categoryById, categoryForType, FREMONT, neighborhoodAt, neighborhoodForGroups, NEIGHBORHOODS } from "./places";

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
