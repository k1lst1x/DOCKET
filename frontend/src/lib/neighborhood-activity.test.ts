import { describe, expect, it } from "vitest";
import {
  countActivity,
  field,
  isStaffEntry,
  requestCategory,
  section,
  summarizeActivity,
  toProject,
  toReport,
  withoutNeighborhood,
  type ActivityRow,
} from "./neighborhood-activity";

const NOW = Date.parse("2026-09-14T21:00:00Z");

const request = (id: string, overrides: Partial<ActivityRow> & { description?: string; status?: string } = {}): ActivityRow => ({
  id,
  source_id: "fremont-app-requests-api",
  title: `Fremont App request CAS-${id}: Pothole – Irvington`,
  url: `https://fremontca.citysourced.com/servicerequests/${id}`,
  published_at: "2026-09-12T17:00:00Z",
  text: [
    `# Fremont App request CAS-${id}: Pothole – Irvington`,
    "",
    `- Case number: CAS-${id}`,
    "- Category: Pothole",
    "- Reported: September 12, 2026, 10:00 AM (Fremont time)",
    `- Status as of September 14, 2026: ${overrides.status ?? "Open (Assigned)"}`,
    "- Address: 4001 Bay St, Fremont, CA 94538",
    "- Neighborhood: Irvington",
    "",
    "## Description",
    overrides.description ?? "Deep pothole in the right lane.",
  ].join("\n"),
  ...overrides,
});

const gis = (id: string, source_id: string, lines: string[], title = "Walnut Ave Improvements – Irvington"): ActivityRow => ({
  id,
  source_id,
  title,
  url: `https://example.gov/${id}`,
  published_at: null,
  text: [`# ${title}`, "", ...lines, "- Neighborhood: Irvington"].join("\n"),
});

describe("record text", () => {
  it("reads labeled lines and sections", () => {
    const text = "- Category: Graffiti\n- Address: 1 Main St\n\n## Description\nPaint on\nthe wall\n## Other\nx";
    expect(field(text, "Category")).toBe("Graffiti");
    expect(field(text, "Missing")).toBeNull();
    expect(section(text, "Description")).toBe("Paint on the wall");
    expect(section(text, "Nope")).toBeNull();
  });

  it("names categories, strips neighborhoods and spots staff entries", () => {
    expect(requestCategory("Fremont App request CAS-1: Sign Damaged / Down - Maintenance – Canyon Heights/Vallejo Mills/Niles Crest")).toBe("Sign Damaged / Down - Maintenance");
    expect(requestCategory("Fremont App request CAS-2: Graffiti")).toBe("Graffiti");
    expect(withoutNeighborhood("Cape and Slurry Seal 2022 – Irvington")).toBe("Cape and Slurry Seal 2022");
    expect(isStaffEntry(request("s", { description: "STAFF ENTRY, ES abatement (Fremont Blvd at Mowry)" }).text)).toBe(true);
    expect(isStaffEntry(request("r").text)).toBe(false);
  });
});

describe("resident reports", () => {
  it("maps a request with open or closed status", () => {
    expect(toReport(request("1"))).toMatchObject({
      caseNumber: "CAS-1",
      category: "Pothole",
      status: "Open (Assigned)",
      open: true,
      address: "4001 Bay St, Fremont, CA 94538",
      description: "Deep pothole in the right lane.",
      reportedAt: "2026-09-12T17:00:00.000Z",
    });
    expect(toReport(request("2", { status: "Closed (Site Cleared)" })).open).toBe(false);
  });
});

describe("city projects", () => {
  it("describes capital, street and development records", () => {
    const capital = toProject(
      gis("c", "fremont-capital-projects-gis", ["- Project: Walnut Ave Improvements", "- Project number: PWC 8944", "- Description: Protected bike lanes.", "- Road: Walnut Ave", "- From: Mission Blvd", "- To: Paseo Padre Pkwy", "- Project page: https://www.fremont.gov/projects"]),
    );
    expect(capital).toMatchObject({
      kind: "capital",
      title: "Walnut Ave Improvements",
      location: "Walnut Ave from Mission Blvd to Paseo Padre Pkwy",
      description: "Protected bike lanes.",
      facts: ["Project: PWC 8944"],
      url: "https://www.fremont.gov/projects",
    });
    const street = toProject(gis("s", "fremont-annual-street-programs-gis", ["- Program: Cape Seal 2022", "- Mapped locations: 6"], "Cape Seal 2022 – Irvington"));
    expect(street).toMatchObject({ kind: "street", title: "Cape Seal 2022", location: "6 street segments" });
    const site = toProject(
      gis("d", "fremont-development-activity-gis", ["- Project: Mission Hills Square", "- Project number: PLN2016-00254", "- Street number: 2501", "- Street: CORMACK RD", "- Status: Under construction", "- Net residential units: 158", "- New commercial (as recorded by the city): 0"], "Mission Hills Square – Irvington"),
    );
    expect(site).toMatchObject({ kind: "development", location: "2501 CORMACK RD", status: "Under construction", facts: ["Project: PLN2016-00254", "Net homes: 158"] });
  });
});

describe("summaries and counts", () => {
  const rows: ActivityRow[] = [
    request("old", { published_at: "2025-01-01T00:00:00Z", status: "Closed" }),
    request("new"),
    request("staff", { description: "STAFF ENTRY, cleanup" }),
    gis("p1", "fremont-capital-projects-gis", ["- Description: Point A"]),
    gis("p2", "fremont-capital-projects-gis", ["- Description: Point B"]),
    gis("d1", "fremont-development-activity-gis", ["- Street: MAIN ST"], "Site A – Irvington"),
    { id: "a1", source_id: "fremont-police-nixle", title: "Road closure", url: "https://local.nixle.com/alert/1/", published_at: "2026-09-11T20:00:00Z", text: "# Road closure\n\n- Agency: Fremont Police Department (CA)\n\n## Full notification\nExpect delays." },
  ];

  it("summarizes a neighborhood, newest reports first, without staff entries or repeated project points", () => {
    const summary = summarizeActivity(rows, NOW);
    expect(summary.reports.map((r) => r.id)).toEqual(["new", "old"]);
    expect(summary).toMatchObject({ reportsLast30Days: 1, reportsTotal: 2, openReports: 1, projectsTotal: 1, developmentTotal: 1 });
    expect(summary.alerts).toMatchObject([{ title: "Road closure", agency: "Fremont Police Department (CA)", excerpt: "Expect delays." }]);
  });

  it("counts per neighborhood for the directory", () => {
    const counts = countActivity(
      [
        { source_id: "fremont-app-requests-api", title: "Fremont App request CAS-1: Pothole – Irvington", published_at: "2026-09-13T00:00:00Z", staff: false },
        { source_id: "fremont-app-requests-api", title: "Fremont App request CAS-2: Graffiti – Irvington", published_at: "2026-01-01T00:00:00Z", staff: false },
        { source_id: "fremont-app-requests-api", title: "Fremont App request CAS-3: Cleanup – Irvington", published_at: "2026-09-14T00:00:00Z", staff: true },
        { source_id: "fremont-capital-projects-gis", title: "Walnut Ave – Irvington", published_at: null, staff: false },
        { source_id: "fremont-capital-projects-gis", title: "Walnut Ave – Irvington", published_at: null, staff: false },
        { source_id: "fremont-development-activity-gis", title: "Site A – Niles", published_at: null, staff: false },
        { source_id: "fremont-capital-projects-gis", title: "No neighborhood", published_at: null, staff: false },
      ],
      NOW,
    );
    expect(counts.get("Irvington")).toEqual({ reportsLast30Days: 1, reportsTotal: 2, projects: 1, development: 0, latestReport: { category: "Pothole", reportedAt: "2026-09-13T00:00:00.000Z" } });
    expect(counts.get("Niles")).toMatchObject({ development: 1, reportsTotal: 0 });
    expect(counts.size).toBe(2);
  });
});
