import { describe, expect, it } from "vitest";
import { currentGroupSlug, getGroup, getWeeklyStats, LEGACY_GROUP_SLUGS, listGroups } from "./data";

describe("neighborhood groups", () => {
  it("has one group for each of Fremont's 32 official neighborhoods", () => {
    const now = Date.parse("2026-09-13T22:00:00Z");
    const groups = listGroups(now);

    expect(groups).toHaveLength(32);
    expect(new Set(groups.map((g) => g.slug)).size).toBe(32);
    for (let index = 1; index < groups.length; index++) {
      expect(Date.parse(groups[index - 1].lastActivityAt)).toBeGreaterThanOrEqual(Date.parse(groups[index].lastActivityAt));
    }
    for (const group of groups) {
      if (group.urgentItem) expect(Date.parse(group.urgentItem.deadline)).toBeGreaterThan(now);
    }
    expect(getGroup("weibel", now)).toMatchObject({ slug: "weibel", name: "Weibel", neighborhoodSlug: "weibel", meets: null, citywideItems: [] });
  });

  it("sends the prototype's sample group slugs to their neighborhood groups", () => {
    expect(LEGACY_GROUP_SLUGS).toEqual({
      "niles-neighbors": "niles",
      "irvington-commons": "irvington",
      "centerville-together": "centerville",
      "warm-springs-hillside": "warm-springs",
    });
    expect(currentGroupSlug("niles-neighbors")).toBe("niles");
    expect(currentGroupSlug("mission-san-jose")).toBe("mission-san-jose");
    expect(getGroup("niles-neighbors")?.slug).toBe("niles");
  });

  it("keeps group detail and weekly stats internally consistent", () => {
    const now = Date.parse("2026-09-13T22:00:00Z");
    const group = getGroup("niles", now);
    const stats = getWeeklyStats(now);

    expect(group?.slug).toBe("niles");
    expect(group?.boundary.length).toBeGreaterThan(3);
    for (const item of group?.items ?? []) {
      expect(["watching", "approved"]).toContain(item.status);
      expect(Date.parse(item.deadline)).toBeGreaterThan(now);
      expect(item.issueId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(item.groupSlug).toBe("niles");
    }
    expect(getGroup("does-not-exist", now)).toBeNull();
    expect(stats).not.toBeNull();
    expect(stats!.pagesRead).toBeGreaterThan(0);
    expect(stats!.documentsRead).toBeGreaterThan(0);
    expect(stats!.windowStart < stats!.windowEnd).toBe(true);
  });
});
