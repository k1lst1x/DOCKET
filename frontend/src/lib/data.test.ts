import { describe, expect, it } from "vitest";
import { getGroup, getWeeklyStats, listGroups } from "./data";

describe("fixture-backed public data", () => {
  it("returns groups in newest activity order and excludes expired or decided watch items", () => {
    const now = Date.parse("2026-09-13T22:00:00Z");
    const groups = listGroups(now);

    expect(groups.length).toBeGreaterThan(0);
    for (let index = 1; index < groups.length; index++) {
      expect(Date.parse(groups[index - 1].lastActivityAt)).toBeGreaterThanOrEqual(Date.parse(groups[index].lastActivityAt));
    }
    for (const group of groups) {
      if (group.urgentItem) expect(Date.parse(group.urgentItem.deadline)).toBeGreaterThan(now);
    }
  });

  it("keeps group detail and weekly stats internally consistent", () => {
    const now = Date.parse("2026-09-13T22:00:00Z");
    const group = getGroup("niles-neighbors", now);
    const stats = getWeeklyStats(now);

    expect(group?.slug).toBe("niles-neighbors");
    for (const item of group?.items ?? []) {
      expect(["watching", "approved"]).toContain(item.status);
      expect(Date.parse(item.deadline)).toBeGreaterThan(now);
      expect(item.issueId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    expect(getGroup("does-not-exist", now)).toBeNull();
    expect(stats).not.toBeNull();
    expect(stats?.pagesRead).toBeGreaterThan(0);
    expect(stats?.documentsRead).toBeGreaterThan(0);
    expect(stats?.windowStart < stats?.windowEnd).toBe(true);
  });
});
