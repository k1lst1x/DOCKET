import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feed } from "./feeds";
import {
  humanizeChpType,
  inNearbyBounds,
  pacificTimeToIso,
  parseCalFire,
  parseChpXml,
  parseClosures,
  parseNwsAlerts,
  parseOutages,
  parseUsgs,
} from "./parsers";
import { getLiveSnapshot, resetLiveCache } from "./snapshot";
import type { LiveIncident } from "./types";

const NOW = Date.parse("2026-09-13T22:00:00Z");

describe("CHP incident log", () => {
  const xml = `<?xml version="1.0" ?>
<State><Center ID = "GGCC"><Dispatch ID = "GGCC">
    <Log ID = "260913GG0453">
      <LogTime>"Sep 13 2026  6:34AM"</LogTime>
      <LogType>"1182-Trfc Collision-No Inj"</LogType>
      <Location>"I880 N / Mowry Ave &amp; Stevenson"</Location>
      <LocationDesc>"NB 880 JSO MOWRY"</LocationDesc>
      <Area>"Hayward"</Area>
      <LATLON>"37530000:121990000"</LATLON>
      <LogDetails><details><DetailTime>"Sep 13 2026  6:40AM"</DetailTime><IncidentDetail>"[2] 1039 TOW 510-555-0100"</IncidentDetail></details></LogDetails></Log>
    <Log ID = "260913GG0460">
      <LogTime>"Sep 13 2026  7:02AM"</LogTime>
      <LogType>"WW-Wrong Way Driver"</LogType>
      <Location>"I680 S / Mission Blvd"</Location>
      <Area>"Dublin"</Area>
      <LATLON>"0:0"</LATLON>
    </Log>
</Dispatch></Center><Center ID = "SAHB"><Dispatch ID = "SACC">
    <Log ID = "260913SA0396">
      <LogTime>"Sep 13 2026 12:35PM"</LogTime>
      <LogType>"1125-Traffic Hazard"</LogType>
      <Location>"I5 N / J St"</Location>
      <Area>"South Sac"</Area>
      <LATLON>"38583003:121503210"</LATLON>
    </Log>
</Dispatch></Center></State>`;

  it("keeps Fremont-area incidents with coordinates, in readable words, without dispatcher notes", () => {
    const incidents = parseChpXml(xml);
    expect(incidents).toHaveLength(1);
    const [collision] = incidents;
    expect(collision).toMatchObject({
      id: "chp-260913GG0453",
      kind: "traffic",
      title: "Collision, no injuries",
      subtitle: "I880 N / Mowry Ave & Stevenson · CHP Hayward",
      severity: "minor",
      lat: 37.53,
      lng: -121.99,
      startedAt: "2026-09-13T13:34:00.000Z",
    });
    expect(JSON.stringify(collision)).not.toContain("510-555");
  });

  it("converts Pacific times across daylight saving", () => {
    expect(pacificTimeToIso("Sep 13 2026  6:34AM")).toBe("2026-09-13T13:34:00.000Z");
    expect(pacificTimeToIso("Jan 5 2026 11:05PM")).toBe("2026-01-06T07:05:00.000Z");
    expect(pacificTimeToIso("Sep 13 2026 12:05AM")).toBe("2026-09-13T07:05:00.000Z");
    expect(pacificTimeToIso("not a time")).toBeNull();
  });

  it("turns CAD codes into plain labels and severities", () => {
    expect(humanizeChpType("1125-Traffic Hazard")).toEqual({ title: "Traffic hazard", severity: "moderate" });
    expect(humanizeChpType("1180-Trfc Collision-Major Inj")).toEqual({ title: "Collision, major injuries", severity: "severe" });
    expect(humanizeChpType("CFIRE-Car Fire")).toEqual({ title: "Car fire", severity: "moderate" });
    expect(humanizeChpType("WW-Wrong Way Driver").title).toBe("Wrong way driver");
    expect(humanizeChpType("ANIMAL-Live or Dead Animal")).toEqual({ title: "Live or dead animal", severity: "minor" });
  });
});

describe("USGS earthquakes", () => {
  it("keeps notable quakes within 150 km of Fremont, and small ones only within 40 km", () => {
    const incidents = parseUsgs({
      features: [
        { id: "tiny-far", properties: { mag: 1.4, place: "10 km NE of San Martin, CA", time: NOW }, geometry: { coordinates: [-121.5322, 37.1552, 9.8] } },
        { id: "tiny-near", properties: { mag: 1.2, place: "3 km E of Fremont, CA", time: NOW - 120_000 }, geometry: { coordinates: [-121.95, 37.55, 7] } },
        { id: "nc75435217", properties: { mag: 2.56, place: "9 km SW of Brentwood, CA", time: NOW - 60_000, url: "https://earthquake.usgs.gov/x" }, geometry: { coordinates: [-121.8032, 37.8742, 16.8] } },
        { id: "ak123", properties: { mag: 4.9, place: "Alaska", time: NOW }, geometry: { coordinates: [-150.1, 61.2, 10] } },
        { id: "bad", properties: { mag: null, place: "?", time: NOW }, geometry: { coordinates: [-121.9, 37.5] } },
      ],
    });
    expect(incidents.map((i) => i.id)).toEqual(["quake-tiny-near", "quake-nc75435217"]);
    expect(incidents[1]).toMatchObject({ title: "M2.6 earthquake", severity: "minor", magnitude: 2.56, sourceName: "USGS" });
  });
});

describe("CAL FIRE", () => {
  it("keeps active fires within 200 km and describes size and containment", () => {
    const incidents = parseCalFire({
      features: [
        { properties: { Name: "Timber Fire ", Final: false, IsActive: true, Started: "2026-08-09T03:35:00Z", County: "Monterey", AcresBurned: 25426.2, PercentContained: 39, Latitude: 36.224857, Longitude: -121.72983, UniqueId: "b7e4", Url: "https://www.fire.ca.gov/incidents/timber" } },
        { properties: { Name: "Out Fire", Final: true, IsActive: false, Latitude: 37.6, Longitude: -121.9, UniqueId: "done" } },
        { properties: { Name: "Far Fire", IsActive: true, Latitude: 34.05, Longitude: -118.24, UniqueId: "la" } },
      ],
    });
    expect(incidents.map((i) => i.id)).toEqual(["fire-b7e4"]);
    expect(incidents[0]).toMatchObject({ title: "Timber Fire", subtitle: "25,426 acres · 39% contained · Monterey County", severity: "severe" });
  });
});

describe("Caltrans closures", () => {
  const closure = (index: string, overrides: { lat?: string; start?: number; end?: number; started?: string; ended?: string }) => ({
    lcs: {
      index,
      location: {
        travelFlowDirection: "North",
        begin: { beginLatitude: overrides.lat ?? "37.5300", beginLongitude: "-121.9600", beginRoute: "I-880", beginLocationName: "Mowry Ave" },
        end: { endLocationName: "Stevenson Blvd" },
      },
      closure: {
        closureTimestamp: { closureStartEpoch: String((overrides.start ?? NOW - 3600_000) / 1000), closureEndEpoch: String((overrides.end ?? NOW + 3600_000) / 1000), isClosureEndIndefinite: "false" },
        typeOfClosure: "Lane",
        typeOfWork: "Paving",
        lanesClosed: "2",
        totalExistingLanes: "4",
        code1097: { isCode1097: overrides.started ?? "true" },
        code1098: { isCode1098: overrides.ended ?? "false" },
        code1022: { isCode1022: "false" },
      },
    },
  });

  it("shows only closures in place now near Fremont", () => {
    const incidents = parseClosures(
      {
        data: [
          closure("active", {}),
          closure("picked-up", { ended: "true" }),
          closure("not-started", { started: "false" }),
          closure("future", { start: NOW + 3600_000 }),
          closure("over", { end: NOW - 60_000 }),
          closure("sonoma", { lat: "38.3333" }),
        ],
      },
      NOW,
    );
    expect(incidents.map((i) => i.id)).toEqual(["closure-active"]);
    expect(incidents[0]).toMatchObject({ title: "Lane closure · I-880 North", subtitle: "Mowry Ave to Stevenson Blvd · Paving · 2 of 4 lanes", severity: "moderate" });
    expect(incidents[0].endsAt).toBe(new Date(NOW + 3600_000).toISOString());
  });
});

describe("power outages", () => {
  it("names the utility, cause and restoration time", () => {
    const incidents = parseOutages({
      features: [
        { properties: { OBJECTID: 1, IncidentId: "353753", UtilityCompany: "PGE", StartDate: NOW - 7200_000, EstimatedRestoreDate: NOW + 3600_000, Cause: "PLNND SHUTDOWN", ImpactedCustomers: 1, OutageStatus: "Active", OutageType: "Planned" }, geometry: { type: "Point", coordinates: [-121.97, 37.54] } },
        { properties: { OBJECTID: 2, UtilityCompany: "PGE", ImpactedCustomers: 4000, OutageStatus: "Active" }, geometry: { type: "Point", coordinates: [-118.2, 34.0] } },
      ],
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ id: "outage-PGE-353753", title: "Power outage · 1 customer", subtitle: "PG&E · Planned · Planned shutdown", sourceName: "PG&E" });
    expect(incidents[0].endsAt).toBe(new Date(NOW + 3600_000).toISOString());
  });
});

describe("weather alerts", () => {
  it("drops expired and cancelled alerts and puts the most severe first", () => {
    const alert = (id: string, severity: string, ends: string, extra: Record<string, string> = {}) => ({
      properties: { id, event: `${severity} event`, severity, status: "Actual", messageType: "Alert", ends, expires: ends, ...extra },
    });
    const alerts = parseNwsAlerts(
      {
        features: [
          alert("a", "Moderate", "2026-09-14T03:00:00Z"),
          alert("b", "Extreme", "2026-09-14T03:00:00Z"),
          alert("old", "Severe", "2026-09-13T20:00:00Z"),
          alert("cancel", "Severe", "2026-09-14T03:00:00Z", { messageType: "Cancel" }),
          alert("test", "Severe", "2026-09-14T03:00:00Z", { status: "Test" }),
        ],
      },
      NOW,
    );
    expect(alerts.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("live snapshot cache", () => {
  beforeEach(() => resetLiveCache());

  const incident = (id: string, startedAt: string): LiveIncident => ({
    id,
    kind: "traffic",
    title: id,
    subtitle: null,
    severity: "minor",
    lat: 37.55,
    lng: -121.98,
    startedAt,
    updatedAt: null,
    endsAt: null,
    magnitude: null,
    sourceName: "Test",
    sourceUrl: null,
  });

  it("refreshes each feed once per interval, keeps last good data when a feed fails, and sorts newest first", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("HTTP 503");
      return { incidents: [incident("older", "2026-09-13T20:00:00Z"), incident("newer", "2026-09-13T21:00:00Z")], alerts: [] };
    });
    const feeds: Feed[] = [{ id: "chp", name: "CHP", ttlMs: 60_000, browser: false, load }];

    const first = await getLiveSnapshot({ now: NOW, feeds });
    expect(first.incidents.map((i) => i.id)).toEqual(["newer", "older"]);
    await getLiveSnapshot({ now: NOW + 30_000, feeds });
    expect(load).toHaveBeenCalledTimes(1);

    fail = true;
    const stale = await getLiveSnapshot({ now: NOW + 61_000, feeds });
    expect(load).toHaveBeenCalledTimes(2);
    expect(stale.incidents).toHaveLength(2);
    expect(stale.feeds[0]).toMatchObject({ ok: false, error: "HTTP 503", fetchedAt: new Date(NOW).toISOString() });

    const gone = await getLiveSnapshot({ now: NOW + 20 * 60_000, feeds });
    expect(gone.incidents).toHaveLength(0);
  });

  it("checks the Fremont area bounds", () => {
    expect(inNearbyBounds(37.5485, -121.9886)).toBe(true);
    expect(inNearbyBounds(37.7749, -122.4194)).toBe(false);
  });
});
