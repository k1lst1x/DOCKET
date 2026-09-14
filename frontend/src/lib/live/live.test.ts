import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feed } from "./feeds";
import { alertToNewsItem, incidentToNewsItem, newsworthyIncident } from "../news/incidents";
import {
  bartTimeToIso,
  citySourcedName,
  citySourcedTimeToIso,
  humanizeChpType,
  inNearbyBounds,
  pacificTimeToIso,
  parseBartAdvisories,
  parseCalFire,
  parseChpXml,
  parseCitySourced,
  parseClosures,
  parseNwsAlerts,
  parseOutages,
  parseUsgs,
} from "./parsers";
import { getLiveSnapshot, resetLiveCache } from "./snapshot";
import type { LiveAlert, LiveIncident } from "./types";

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

  it("puts the most severe alert first across feeds", async () => {
    const alert = (id: string, severity: LiveAlert["severity"]): LiveAlert => ({
      id,
      event: id,
      headline: null,
      severity,
      urgency: null,
      effective: null,
      endsAt: null,
      areaDesc: null,
      description: null,
      instruction: null,
      sourceUrl: null,
    });
    const feeds: Feed[] = [
      { id: "alerts", name: "NWS", ttlMs: 60_000, browser: true, load: async () => ({ incidents: [], alerts: [alert("wind", "Minor")] }) },
      { id: "bart", name: "BART", ttlMs: 60_000, browser: false, load: async () => ({ incidents: [], alerts: [alert("bart-1", "Severe")] }) },
    ];
    expect((await getLiveSnapshot({ now: NOW, feeds })).alerts.map((a) => a.id)).toEqual(["bart-1", "wind"]);
  });
});

describe("Fremont App resident reports", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    Id: "aaaa-1",
    CaseNumber: "CAS-12345-ABCDEF",
    CreatedOn: "9/13/2026 5:30:19 PM",
    ModifiedOn: "9/13/2026 6:00:00 PM",
    Description: "Tent on the sidewalk blocking the path. Call me at 510-555-0142 or jane@example.com",
    Line1: "39100 Liberty St",
    ZipCode: "94538",
    Latitude: "37.5485",
    Longitude: "-121.9886",
    ServiceActivityStatus: { Id: "s1", NameEN: "Open", NameES: "Abierto" },
    ServiceActivityStatusReason: { Id: "r1", NameEN: "Assigned", NameES: "Asignado" },
    RequestDetail: { Id: "d1", Name: "Encampment - Tent - Homeless Response", NameEN: "Encampment - Tent - Homeless Response" },
    ReportedById: "reporter-secret-guid",
    ParentCaseId: "parent-1",
    HasImage: false,
    ...overrides,
  });
  const parse = (...records: Record<string, unknown>[]) => parseCitySourced({ HasErrors: false, ResultsCount: records.length, Results: records }, NOW);

  it("maps a recent report with category, address, status and case number, without contact details or reporter ids", () => {
    const [report] = parse(record());
    expect(report).toMatchObject({
      id: "report-aaaa-1",
      kind: "report",
      title: "Encampment - Tent - Homeless Response",
      severity: "minor",
      lat: 37.5485,
      lng: -121.9886,
      startedAt: "2026-09-13T17:30:19.000Z",
      updatedAt: "2026-09-13T18:00:00.000Z",
      endsAt: null,
      magnitude: null,
      sourceName: "Fremont App",
      sourceUrl: "https://fremontca.citysourced.com/servicerequests/aaaa-1",
    });
    expect(report.subtitle).toMatch(/^39100 Liberty St · Open \(Assigned\) · CAS-12345-ABCDEF · “Tent on the sidewalk/);
    const json = JSON.stringify(report);
    expect(json).not.toContain("reporter-secret-guid");
    expect(json).not.toContain("555-0142");
    expect(json).not.toContain("jane@example.com");
  });

  it("keeps reports inside the Fremont area with valid coordinates", () => {
    const incidents = parse(
      record({ Id: "in" }),
      record({ Id: "sf", Latitude: "37.7749", Longitude: "-122.4194" }),
      record({ Id: "blank", Latitude: "", Longitude: "" }),
      record({ Id: "null", Latitude: null, Longitude: null }),
      record({ Id: "junk", Latitude: "n/a", Longitude: "-121.98" }),
    );
    expect(incidents.map((i) => i.id)).toEqual(["report-in"]);
  });

  it("keeps the last 7 days, plus older reports still open that changed this week", () => {
    const incidents = parse(
      record({ Id: "new-closed", ServiceActivityStatus: { NameEN: "Closed" }, ServiceActivityStatusReason: { NameEN: "Service Completed" } }),
      record({ Id: "old-open-touched", CreatedOn: "7/1/2026 9:00:00 AM", ModifiedOn: "9/12/2026 9:00:00 AM" }),
      record({ Id: "old-closed-touched", CreatedOn: "7/1/2026 9:00:00 AM", ModifiedOn: "9/12/2026 9:00:00 AM", ServiceActivityStatus: { NameEN: "Closed" } }),
      record({ Id: "old-open-quiet", CreatedOn: "7/1/2026 9:00:00 AM", ModifiedOn: "7/2/2026 9:00:00 AM" }),
      record({ Id: "week-old-open", CreatedOn: "9/1/2026 9:00:00 AM" }),
      record({ Id: "duplicate", ServiceActivityStatus: { NameEN: "Duplicate" } }),
      record({ Id: "staff", Description: "STAFF ENTRY, ES clean up (Industrial Dr ROW)" }),
    );
    expect(incidents.map((i) => i.id)).toEqual(["report-new-closed", "report-old-open-touched", "report-week-old-open"]);
    expect(incidents.map((i) => i.severity)).toEqual(["minor", "moderate", "moderate"]);
    expect(incidents[0].subtitle).toContain("Closed (Service Completed)");
  });

  it("reads Python-style lookup values, apostrophes included, and falls back when the category is missing", () => {
    const incidents = parse(
      record({
        Id: "repr",
        RequestDetail: `{'Id': 'x', 'NameEN': "Other (City Manager's Office)", 'NameES': "Otro"}`,
        ServiceActivityStatus: "{'Id': 's', 'NameEN': 'Pending', 'NameES': 'Pendiente'}",
        ServiceActivityStatusReason: "{'Id': 'r', 'NameEN': 'Pending', 'NameES': 'Pendiente'}",
      }),
      record({ Id: "none", RequestDetail: null, ServiceActivityStatusReason: null, Description: null }),
    );
    expect(incidents[0].title).toBe("Other (City Manager's Office)");
    expect(incidents[0].subtitle).toBe("39100 Liberty St · Pending · CAS-12345-ABCDEF · “Tent on the sidewalk blocking the path. Call me at [phone] or [email]”");
    expect(incidents[1]).toMatchObject({ title: "Service request", subtitle: "39100 Liberty St · Open · CAS-12345-ABCDEF" });
    expect(citySourcedName("{'Id': 'a', 'NameEN': 'Closed', 'NameES': 'Cerrado'}")).toBe("Closed");
    expect(citySourcedName(null)).toBeNull();
  });

  it("shortens long descriptions and parses UTC times", () => {
    const [report] = parse(record({ Description: "word ".repeat(80) }));
    expect(report.subtitle?.endsWith("…”")).toBe(true);
    expect(report.subtitle!.length).toBeLessThan(200);
    expect(citySourcedTimeToIso("1/5/2026 12:05:09 AM")).toBe("2026-01-05T00:05:09.000Z");
    expect(citySourcedTimeToIso("9/14/2026 12:30:00 PM")).toBe("2026-09-14T12:30:00.000Z");
    expect(citySourcedTimeToIso("yesterday")).toBeNull();
  });

  it("goes in the news for three days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const [report] = parse(record());
      expect(incidentToNewsItem(report)).toMatchObject({ category: "community", source: "Fremont App", kind: "incident" });
      expect(newsworthyIncident(report)).toBe(true);
      expect(newsworthyIncident({ ...report, startedAt: new Date(NOW - 4 * 86_400_000).toISOString() })).toBe(false);
      expect(newsworthyIncident({ ...report, startedAt: null })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BART advisories", () => {
  const item = (id: string, station: string, description: string, extra: Record<string, unknown> = {}) => ({
    "@id": id,
    station,
    type: "DELAY",
    description: { "#cdata-section": description },
    sms_text: { "#cdata-section": description },
    posted: "Sun Sep 13 2026 01:15 PM PDT",
    expires: "No time provided.",
    ...extra,
  });
  const feed = (bsa: unknown) => ({ root: { date: "09/13/2026", time: "15:00:00 PM PDT", bsa } });

  it("reads Pacific posted and expiry times", () => {
    expect(bartTimeToIso("Mon Sep 14 2026 06:27 AM PDT")).toBe("2026-09-14T13:27:00.000Z");
    expect(bartTimeToIso("Mon Jan 05 2026 11:05 PM PST")).toBe("2026-01-06T07:05:00.000Z");
    expect(bartTimeToIso("No time provided.")).toBeNull();
  });

  it("skips the no-delays placeholder, whether bsa is one object or a list", () => {
    expect(parseBartAdvisories(feed({ "@id": "", station: "", description: { "#cdata-section": "No delays reported." } }), NOW)).toEqual([]);
    expect(parseBartAdvisories(feed([{ station: "", description: { "#cdata-section": "No delays reported." } }]), NOW)).toEqual([]);
    expect(parseBartAdvisories(feed(item("1", "FRMT", "Elevator out at Fremont.", { type: "" })), NOW).map((a) => a.id)).toEqual(["bart-1"]);
  });

  it("keeps advisories for Fremont-area stations and systemwide ones that affect them, most severe first", () => {
    const alerts = parseBartAdvisories(
      feed([
        item("560", "BART", "Expect 30-minute delays between Millbrae, SFO, and Daly City stations due to construction. More details online."),
        item("561", "BART", "A 15-minute delay on the Berryessa/North San José–Richmond (Orange) line in the Fremont direction. Trains are single tracking."),
        item("562", "WARM", "Police activity at Warm Springs. Expect delays.", { type: "EMERGENCY", expires: "Sun Sep 13 2026 11:00 PM PDT" }),
        item("563", "MONT", "Escalator out at Montgomery Street. Fremont riders unaffected."),
        item("564", "BART", "Systemwide delays due to a power problem. Allow extra time.", { type: "INFO" }),
        item("565", "UCTY", "Parking lot closed.", { type: "INFO", expires: "Sun Sep 13 2026 01:00 PM PDT" }),
      ]),
      NOW,
    );
    expect(alerts.map((a) => a.id)).toEqual(["bart-562", "bart-561", "bart-564"]);
    expect(alerts[0]).toMatchObject({
      event: "BART emergency",
      headline: "Police activity at Warm Springs.",
      severity: "Severe",
      effective: "2026-09-13T20:15:00.000Z",
      endsAt: "2026-09-14T06:00:00.000Z",
      areaDesc: "Warm Springs/South Fremont",
      description: "Police activity at Warm Springs. Expect delays.",
      sourceName: "BART",
      sourceUrl: "https://www.bart.gov/schedules/advisories",
    });
    expect(alerts[1]).toMatchObject({ event: "BART delay", severity: "Moderate", endsAt: null, areaDesc: "All BART stations" });
    expect(alerts[2]).toMatchObject({ event: "BART advisory", severity: "Minor" });
  });

  it("labels BART alerts as BART in the news, and weather alerts as the weather service", () => {
    const [bart] = parseBartAdvisories(feed(item("9", "FRMT", "Delays at Fremont.")), NOW);
    expect(alertToNewsItem(bart)).toMatchObject({ source: "BART", category: "traffic", title: "BART delay" });
    const { sourceName: _drop, ...weather } = bart;
    void _drop;
    expect(alertToNewsItem(weather)).toMatchObject({ source: "National Weather Service", category: "disaster" });
  });
});
