import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverview, cleanExcerpt, cleanThemes, getSentimentOverview, weekKey, type CommentRow, type TopicRow } from "./sentiment";

vi.mock("./db", () => ({
  db: () => {
    throw new Error("database should not be reached without DSQL_ENDPOINT");
  },
}));

const TOPIC: TopicRow = {
  id: "cc-2026-09-08-7a",
  issue_id: null,
  body: "city_council",
  meeting_date: "2026-09-08",
  item_label: "Item 7A",
  title: "North Fremont community center",
  neighborhood_slugs: ["ardenwood", "not-a-neighborhood"],
  comment_count: 30,
  support_count: 8,
  oppose_count: 17,
  mixed_count: 3,
  neutral_count: 2,
  themes: [
    { theme: "distance to existing centers", count: 9 },
    { theme: "traffic on Paseo Padre", count: 6 },
    { theme: "call 510-555-0199", count: 3 },
    { theme: "", count: 2 },
    { theme: "parking", count: 0 },
  ],
  source_url: "https://fremont.gov/agenda/2026-09-08",
  generated_at: "2026-09-12T10:00:00Z",
  model: "gpt-oss-120b",
};

const comment = (stance: string, excerpt: string, sent_at: string | null = "2026-09-03T12:00:00Z", author_area: string | null = "Ardenwood"): CommentRow => ({
  topic_id: TOPIC.id,
  stance,
  sent_at,
  author_area,
  excerpt,
  locator: "p. 12",
});

describe("excerpts shown on the page", () => {
  it("redact contact details a second time", () => {
    expect(cleanExcerpt("Email me at jane.doe@example.com or 510-555-0147, I live at 4321 Paseo Padre Pkwy.")).toBe(
      "Email me at [redacted] or [redacted], I live at [redacted]",
    );
    expect(cleanExcerpt("Call (510) 555 0147 about 38 N. Mission Blvd traffic.")).toBe("Call [redacted] about [redacted] traffic.");
  });

  it("keep ordinary text and drop text that fails the language filter", () => {
    expect(cleanExcerpt("  Please build it closer to Ardenwood.  ")).toBe("Please build it closer to Ardenwood.");
    expect(cleanExcerpt("This plan is f*cking terrible")).toBeNull();
    expect(cleanExcerpt("   ")).toBeNull();
  });
});

describe("themes", () => {
  it("keep short clean labels with positive counts, most common first", () => {
    expect(cleanThemes(TOPIC.themes)).toEqual([
      { theme: "distance to existing centers", count: 9 },
      { theme: "traffic on Paseo Padre", count: 6 },
    ]);
    expect(cleanThemes("nope")).toEqual([]);
    // A stance isn't a theme: the stance chart already shows it.
    expect(cleanThemes([{ theme: "Support", count: 7 }, { theme: "opposition", count: 2 }, { theme: "senior programs", count: 2 }])).toEqual([
      { theme: "senior programs", count: 2 },
    ]);
  });
});

describe("weeks", () => {
  it("start on Monday", () => {
    expect(weekKey("2026-09-13T20:00:00Z")).toBe("2026-09-07");
    expect(weekKey("2026-09-07T01:00:00Z")).toBe("2026-09-07");
    expect(weekKey("2026-09-06T23:00:00Z")).toBe("2026-08-31");
  });
});

describe("overview", () => {
  const rows = [
    comment("oppose", "Too far from Centerville."),
    comment("oppose", "Not near transit."),
    comment("support", "North Fremont needs this.", "2026-08-28T09:00:00Z"),
    comment("mixed", "Good idea, wrong site.", null, null),
    comment("oppose", "This is sh*t planning"),
    comment("banana", "Not a stance"),
  ];
  const overview = buildOverview([TOPIC], rows);

  it("counts stances from the topic rows and known neighborhoods only", () => {
    expect(overview.totals).toEqual({ support: 8, oppose: 17, mixed: 3, neutral: 2, comments: 30, topics: 1 });
    expect(overview.topics[0]).toMatchObject({ body: "City Council", total: 30, neighborhoods: [{ slug: "ardenwood", name: "Ardenwood" }] });
    expect(overview.neighborhoods).toEqual([{ slug: "ardenwood", name: "Ardenwood", count: 30 }]);
    // Where writers live comes only from their own words, counted per filed comment (including ones whose excerpt is hidden).
    expect(overview.writerAreas).toEqual([{ label: "Ardenwood", count: 4 }]);
    expect(buildOverview([TOPIC], [comment("support", "Yes", null, "District 1"), comment("support", "Yes", null, "4321 Oak St")]).writerAreas).toEqual([
      { label: "District 1", count: 1 },
    ]);
    expect(overview.themes[0]).toEqual({ theme: "distance to existing centers", count: 9 });
    expect(overview.updatedAt).toBe("2026-09-12T10:00:00.000Z");
    expect(overview.models).toEqual(["gpt-oss-120b"]);
  });

  it("shows up to three excerpts across different stances, never ones that fail the filter", () => {
    const excerpts = overview.topics[0].excerpts;
    expect(excerpts.map((e) => e.stance)).toEqual(["support", "oppose", "mixed"]);
    expect(excerpts.some((e) => e.text.includes("sh*t"))).toBe(false);
    expect(excerpts.find((e) => e.stance === "mixed")).toMatchObject({ authorArea: null, sentAt: null });
  });

  it("never repeats the same form-letter words", () => {
    const formLetters = [
      comment("support", "I support Agenda Item 7A to build a North Fremont community center."),
      comment("support", "I support agenda item 7A to build a North Fremont community center!"),
      comment("support", "Our kids need a place to go after school."),
      comment("support", "I support Agenda Item 7A to build a North Fremont community center."),
    ];
    expect(buildOverview([TOPIC], formLetters).topics[0].excerpts.map((e) => e.text)).toEqual([
      "I support Agenda Item 7A to build a North Fremont community center.",
      "Our kids need a place to go after school.",
    ]);
  });

  it("buckets comments by week from their date lines", () => {
    // The unfiltered comment still counts toward volume; comments without a date and unknown stances don't.
    expect(overview.byWeek).toEqual([
      { week: "2026-08-24", count: 1 },
      { week: "2026-08-31", count: 3 },
    ]);
  });

  it("drops non-web source links", () => {
    expect(buildOverview([{ ...TOPIC, source_url: "javascript:alert(1)" }], []).topics[0].sourceUrl).toBeNull();
  });
});

describe("without a database", () => {
  const saved = process.env.DSQL_ENDPOINT;
  afterEach(() => {
    if (saved === undefined) delete process.env.DSQL_ENDPOINT;
    else process.env.DSQL_ENDPOINT = saved;
  });

  it("returns nothing, so the page shows its empty state", async () => {
    delete process.env.DSQL_ENDPOINT;
    expect(await getSentimentOverview()).toBeNull();
  });
});
