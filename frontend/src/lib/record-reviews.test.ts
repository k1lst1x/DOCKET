import { describe, expect, it } from "vitest";
import { checkReviewBody, RecordReviewError, toRecordReviews } from "./record-reviews";

const row = (id: string, member: string, body: string, extra: { name?: string; updated?: string; sample?: boolean } = {}) => ({
  id,
  body,
  created_at: "2026-09-14T18:00:00Z",
  updated_at: extra.updated ?? "2026-09-14T18:00:00Z",
  member_id: member,
  name: extra.name ?? "Maria Lopez",
  is_sample: extra.sample ?? false,
});

describe("record reviews", () => {
  it("shows reviews with short names, marks the viewer's own and edited ones", () => {
    const reviews = toRecordReviews(
      [row("1", "me", "Still broken as of this morning.", { updated: "2026-09-14T19:00:00Z" }), row("2", "other", "The city fixed it on Tuesday.", { name: "Sam Kim" })],
      "me",
    );
    expect(reviews.mine).toEqual({ body: "Still broken as of this morning." });
    expect(reviews.items).toEqual([
      { id: "1", author: "Maria L.", body: "Still broken as of this morning.", createdAt: "2026-09-14T18:00:00.000Z", edited: true, mine: true, sample: false },
      { id: "2", author: "Sam K.", body: "The city fixed it on Tuesday.", createdAt: "2026-09-14T18:00:00.000Z", edited: false, mine: false, sample: false },
    ]);
  });

  it("hides a review that fails moderation from everyone but its author", () => {
    const rows = [row("1", "author", "This is fucking ridiculous, fix it.")];
    expect(toRecordReviews(rows, null).items).toEqual([]);
    expect(toRecordReviews(rows, "author").items.map((r) => r.id)).toEqual(["1"]);
  });

  it("validates review text", () => {
    expect(checkReviewBody("  Still broken today.  ")).toBe("Still broken today.");
    const code = (value: unknown) => {
      try {
        checkReviewBody(value);
        return null;
      } catch (error) {
        return error instanceof RecordReviewError ? error.code : "other";
      }
    };
    expect(code("short")).toBe("invalid_review");
    expect(code("x".repeat(2001))).toBe("invalid_review");
    expect(code(42)).toBe("invalid_review");
    expect(code("What a shit response from the city.")).toBe("review_blocked");
  });
});
