import { describe, expect, it } from "vitest";
import { alertTopic, buildRecordDetail, lastMonths, neighborhoodOf, recordFacts, recordPoints, streetSegments, type RecordRow } from "./record-detail";

const NOW = Date.parse("2026-09-14T21:00:00Z");

const report = (id: string, category: string, publishedAt: string, extra: { status?: string; coords?: string; description?: string } = {}): RecordRow => ({
  id,
  source_id: "fremont-app-requests-api",
  title: `Fremont App request CAS-${id}: ${category} – Warm Springs`,
  url: `https://fremontca.citysourced.com/servicerequests/${id}`,
  published_at: publishedAt,
  text: [
    `# Fremont App request CAS-${id}: ${category} – Warm Springs`,
    "",
    `- Case number: CAS-${id}`,
    `- Category: ${category}`,
    "- Reported: September 14, 2026, 10:00 AM (Fremont time)",
    `- Status as of September 14, 2026: ${extra.status ?? "Open (Assigned)"}`,
    "- Address: 48645 Flagstaff Ct, Fremont, CA 94539",
    "- Neighborhood: Warm Springs",
    `- Coordinates: ${extra.coords ?? "37.48000, -121.92000"}`,
    "",
    "## Description",
    extra.description ?? "Traffic signal lights have been out since Friday morning.",
  ].join("\n"),
});

describe("record text", () => {
  it("lists facts without map, neighborhood or link lines", () => {
    expect(recordFacts(report("1", "Traffic Signals", "2026-09-14T17:00:00Z").text)).toEqual([
      { label: "Case number", value: "CAS-1" },
      { label: "Category", value: "Traffic Signals" },
      { label: "Reported", value: "September 14, 2026, 10:00 AM (Fremont time)" },
      { label: "Status", value: "Open (Assigned)" },
      { label: "Address", value: "48645 Flagstaff Ct, Fremont, CA 94539" },
    ]);
  });

  it("reads points, street segments and the neighborhood", () => {
    const text = "# Cape Seal 2022 – Irvington\n\n- Neighborhood: Irvington\n\n## Adams Ave\n- Road: Adams Ave\n- From: Fremont Blvd\n- To: Roberts Ave\n- Work type: Cape Seal\n- Map location (approximate): 37.52969, -121.95733\n\n## Howe Ct\n- Road: Howe Ct\n- Map location (approximate): 37.52515, -121.95383";
    expect(recordPoints(text, "x")).toEqual([
      { lat: 37.52969, lng: -121.95733, label: "x" },
      { lat: 37.52515, lng: -121.95383, label: "x" },
    ]);
    expect(streetSegments(text)).toEqual([
      { road: "Adams Ave", from: "Fremont Blvd", to: "Roberts Ave", work: "Cape Seal" },
      { road: "Howe Ct", from: null, to: null, work: null },
    ]);
    expect(neighborhoodOf({ title: "Cape Seal 2022 – Irvington", text })).toBe("Irvington");
    expect(neighborhoodOf({ title: "Site – Niles", text: "" })).toBe("Niles");
  });

  it("buckets months and topics", () => {
    expect(lastMonths(NOW, 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(alertTopic("Press Release: Fatal Traffic Collision on August 25, 2026")).toBe("Traffic and roads");
    expect(alertTopic("New Fremont Police Week in Review available online!")).toBe("Week in review");
    expect(alertTopic("Suspect arrested after robbery")).toBe("Crime and safety");
  });
});

describe("record popups", () => {
  it("charts a resident report against its neighborhood", () => {
    const record = report("1", "Traffic Signals", "2026-09-14T17:00:00Z");
    const others = [
      record,
      report("2", "Traffic Signals", "2026-08-02T17:00:00Z", { status: "Closed (Repaired)", coords: "37.48100, -121.92100" }),
      report("3", "Graffiti", "2026-09-01T17:00:00Z", { coords: "37.60000, -121.80000" }),
      report("4", "Graffiti", "2024-01-01T17:00:00Z"),
      report("5", "Cleanup", "2026-09-10T17:00:00Z", { description: "STAFF ENTRY, cleanup" }),
    ];
    const detail = buildRecordDetail(record, others, NOW);
    expect(detail).toMatchObject({ kind: "report", title: "Traffic Signals", neighborhood: "Warm Springs", open: true, body: "Traffic signal lights have been out since Friday morning." });
    expect(detail.points).toEqual([{ lat: 37.48, lng: -121.92, label: "Traffic Signals" }]);
    expect(detail.charts.monthly.at(-1)).toEqual({ month: "2026-09", value: 2, highlight: 1 });
    expect(detail.charts.monthly.at(-2)).toEqual({ month: "2026-08", value: 1, highlight: 1 });
    expect(detail.charts.outcome).toEqual([
      { label: "Open", value: 1 },
      { label: "Closed: Repaired", value: 1 },
    ]);
    expect(detail.charts.breakdown).toEqual([
      { label: "Traffic Signals", value: 2 },
      { label: "Graffiti", value: 1 },
    ]);
    // Within half a mile: report 2 only (report 3 is far away; staff entries never count).
    expect(detail.related.map((r) => r.id)).toEqual(["2"]);
  });

  it("compares a development site with others nearby", () => {
    const site = (id: string, name: string, net: number): RecordRow => ({
      id,
      source_id: "fremont-development-activity-gis",
      title: `${name} – Warm Springs`,
      url: `https://example.gov/${id}`,
      published_at: null,
      text: `# ${name} – Warm Springs\n\n- Project: ${name}\n- Project number: PLN-${id}\n- Status: UC\n- New townhouse units: ${net}\n- Net residential units: ${net}\n- Neighborhood: Warm Springs\n- Map location (approximate): 37.48, -121.92\n- Project page: https://www.fremont.gov/x`,
    });
    const record = site("a", "Palmia", 171);
    const detail = buildRecordDetail(record, [site("b", "Village 4", 66), site("c", "Village 6", 70)], NOW);
    expect(detail).toMatchObject({ kind: "development", projectKind: "development", title: "Palmia", status: "UC" });
    expect(detail.charts.breakdown).toEqual([{ label: "Townhouses", value: 171 }]);
    expect(detail.charts.comparison.map((c) => c.label)).toEqual(["Palmia", "Village 6", "Village 4"]);
    expect(detail.links).toEqual([{ label: "City project page", url: "https://www.fremont.gov/x" }]);
    expect(detail.related.map((r) => r.title)).toEqual(["Village 4", "Village 6"]);
  });

  it("counts an agency's notices per month", () => {
    const alert = (id: string, title: string, at: string): RecordRow => ({
      id,
      source_id: "fremont-police-nixle",
      title,
      url: `https://local.nixle.com/alert/${id}/`,
      published_at: at,
      text: `# ${title}\n\n- Agency: Fremont Police Department (CA)\n- Priority: Community\n\n## Full notification\n${title} details.`,
    });
    const record = alert("1", "Press Release: Fatal Traffic Collision", "2026-09-09T18:00:00Z");
    const detail = buildRecordDetail(record, [record, alert("2", "Week in Review", "2026-09-11T20:00:00Z"), alert("3", "Road closure", "2026-07-01T20:00:00Z")], NOW);
    expect(detail).toMatchObject({ kind: "alert", neighborhood: null, body: "Press Release: Fatal Traffic Collision details." });
    expect(detail.charts.monthly.at(-1)).toMatchObject({ month: "2026-09", value: 2 });
    expect(detail.charts.breakdown[0]).toEqual({ label: "Traffic and roads", value: 2 });
    expect(detail.related.map((r) => r.id)).toEqual(["2", "3"]);
  });
});
