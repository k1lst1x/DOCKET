import { afterEach, describe, expect, it, vi } from "vitest";
import {
  firstSentence,
  getLiveGroup,
  getLiveWeeklyStats,
  hasDatabase,
  itemScope,
  listLiveGroups,
  toOutcome,
  toWatchItem,
  type IssueItemRow,
  type OutcomeDbRow,
} from "./live-data";

vi.mock("./db", () => ({
  db: () => {
    throw new Error("database should not be reached without DSQL_ENDPOINT");
  },
}));

// The saved sample content (lib/data.ts reads fixtures through the "@/" alias, which tests don't resolve).
vi.mock("./data", () => {
  const group = {
    id: "grp_niles",
    slug: "niles",
    neighborhoodSlug: "niles",
    name: "Niles",
    district: "Niles",
    description: "Neighbors in Niles",
    boundary: [],
    memberCount: 0,
    watchlist: [],
    foundedOn: "2026-09-13",
    lastActivityAt: "2026-09-01T00:00:00Z",
    meets: null,
  };
  const sampleItem = { id: "i1", issueId: "sample-cc-1", ref: "CC-1", title: "Sample item", deadline: "2030-01-01T00:00:00Z", deadlineKind: "Comments due" };
  return {
    getGroup: (slug: string) => (slug === group.slug || slug === "niles-neighbors" ? { ...group, items: [sampleItem], citywideItems: [], outcomes: [] } : null),
    listGroups: () => [{ ...group, urgentItem: { ref: "CC-1", title: "Sample item", deadline: "2030-01-01T00:00:00Z", deadlineKind: "Comments due" } }],
    getWeeklyStats: () => ({ source: "sample", pagesRead: 10, documentsRead: 2, itemsSurfaced: 1, neighborhoods: 1, windowStart: "", windowEnd: "", isCurrentWeek: true }),
  };
});

const ROW: IssueItemRow = {
  id: "za-2026-08-18-2",
  ref: "ZA 2026-08-18 item 2",
  title: "Accessory dwelling unit at 3900 Thornton Ave",
  body: "Zoning Administrator, public hearing",
  meeting_at: new Date("2026-09-22T17:00:00Z"),
  deadline: null,
  deadline_kind: null,
  topic: "Housing",
  status: "watching",
  citation: "ZA agenda, Aug 18 2026, p. 4",
  surfaced_at: new Date("2026-09-12T10:00:00Z"),
  summary: "A homeowner asks to add a 900 sq ft backyard unit. Neighbors raised parking concerns.",
};

describe("group page cards from real issues", () => {
  it("use the meeting time when there's no separate comment deadline", () => {
    expect(toWatchItem(ROW, "niles")).toMatchObject({
      id: "za-2026-08-18-2",
      issueId: "za-2026-08-18-2",
      groupSlug: "niles",
      deadline: "2026-09-22T17:00:00.000Z",
      meetingAt: "2026-09-22T17:00:00.000Z",
      deadlineKind: "Meeting",
      brief: "A homeowner asks to add a 900 sq ft backyard unit.",
      topic: "Housing",
      body: "Zoning Administrator, public hearing",
    });
  });

  it("keep a real comment deadline and skip items with no date at all", () => {
    const withDeadline = toWatchItem({ ...ROW, deadline: "2026-09-20T00:00:00Z", deadline_kind: "Public comment" }, "g");
    expect(withDeadline).toMatchObject({ deadline: "2026-09-20T00:00:00.000Z", deadlineKind: "Public comment", meetingAt: "2026-09-22T17:00:00.000Z" });
    expect(toWatchItem({ ...ROW, meeting_at: null, deadline: null }, "g")).toBeNull();
    expect(toWatchItem({ ...ROW, summary: null, topic: " " }, "g")).toMatchObject({ brief: "", topic: "City hall" });
  });

  it("shorten summaries to a first sentence", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("No period here")).toBe("No period here");
    expect(firstSentence("x".repeat(400), 20)).toHaveLength(20);
    expect(firstSentence(null)).toBe("");
  });
});

describe("which group page an item belongs on", () => {
  const weibel = { slug: "weibel", neighborhoodSlug: "weibel" };
  it("puts items on the neighborhood they name, citywide items everywhere, and others nowhere", () => {
    expect(itemScope({ group_slug: null, neighborhood_slugs: ["weibel"] }, weibel)).toBe("group");
    expect(itemScope({ group_slug: "weibel", neighborhood_slugs: [] }, weibel)).toBe("group");
    expect(itemScope({ group_slug: null, neighborhood_slugs: [] }, weibel)).toBe("citywide");
    expect(itemScope({ group_slug: null, neighborhood_slugs: null }, weibel)).toBe("citywide");
    expect(itemScope({ group_slug: null, neighborhood_slugs: ["niles"] }, weibel)).toBeNull();
    expect(itemScope({ group_slug: "niles", neighborhood_slugs: [] }, weibel)).toBeNull();
  });
});

describe("outcomes from meeting minutes", () => {
  const OUTCOME: OutcomeDbRow = {
    id: "cc-2026-09-08-7a",
    body: "city_council",
    meeting_date: "2026-09-08",
    item_label: "Item 7A",
    title: "North Fremont community center site",
    result: "continued",
    action_text: "Continued to October 6 for more site options.",
    vote: { ayes: 5, noes: 2, abstain: 0, absent: 0 },
    source_url: "https://fremont.gov/minutes",
  };

  it("map results, meeting bodies and vote counts", () => {
    expect(toOutcome(OUTCOME)).toEqual({
      id: "cc-2026-09-08-7a",
      ref: "City Council · Item 7A",
      title: "North Fremont community center site",
      body: "Continued to October 6 for more site options.",
      decidedOn: "2026-09-08",
      result: "Continued",
      vote: { yes: 5, no: 2, abstain: 0, absent: 0 },
      groupPosition: "No position",
      note: "",
      sourceUrl: "https://fremont.gov/minutes",
    });
  });

  it("leave out vote counts the minutes don't give, and skip rows it can't read", () => {
    expect(toOutcome({ ...OUTCOME, vote: null, result: "received" })).toMatchObject({ vote: null, result: "Received and filed" });
    expect(toOutcome({ ...OUTCOME, vote: { ayes: "five", noes: -1 } })?.vote).toEqual({ yes: 0, no: 0, abstain: 0, absent: 0 });
    expect(toOutcome({ ...OUTCOME, result: "tabled" })).toBeNull();
    expect(toOutcome({ ...OUTCOME, meeting_date: "Sept 8" })).toBeNull();
    expect(toOutcome({ ...OUTCOME, source_url: "javascript:alert(1)" })?.sourceUrl).toBeNull();
  });
});

describe("without a database", () => {
  const saved = process.env.DSQL_ENDPOINT;
  afterEach(() => {
    if (saved === undefined) delete process.env.DSQL_ENDPOINT;
    else process.env.DSQL_ENDPOINT = saved;
  });

  it("keeps the saved sample content for the static preview", async () => {
    delete process.env.DSQL_ENDPOINT;
    expect(hasDatabase()).toBe(false);
    expect(await getLiveGroup("niles")).toMatchObject({ slug: "niles", live: false });
    expect(await getLiveGroup("no-such-group")).toBeNull();
    const list = await listLiveGroups();
    expect(list.groups.length).toBeGreaterThan(0);
    expect(list.citywideCount).toBe(0);
    expect((await getLiveWeeklyStats())?.source).toBe("sample");
  });

  it("shows no sample items when the database is configured but unreachable", async () => {
    process.env.DSQL_ENDPOINT = "example.dsql.us-west-2.on.aws";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getLiveGroup("niles")).toMatchObject({ items: [], citywideItems: [], outcomes: [], live: false });
    expect((await listLiveGroups()).groups.every((g) => g.urgentItem === null)).toBe(true);
    expect(await getLiveWeeklyStats()).toBeNull();
    error.mockRestore();
  });
});
