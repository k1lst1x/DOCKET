import { describe, expect, it } from "vitest";
import { SAMPLE_POSTS, samplePostId, sampleReplyId } from "../data/sample-posts";
import { moderateText } from "./moderation";
import { areaBySlug } from "./places";
import { POST_MAX_LENGTH, sampleFeed, sampleMemberHome, sampleMemberName, sampleReplies, shortName, validatePostBody } from "./posts-shared";

const NOW = Date.parse("2026-09-13T22:00:00Z");

describe("validatePostBody", () => {
  it("trims and accepts ordinary posts up to the limit", () => {
    expect(validatePostBody("  Anyone going to the fair?  ")).toEqual({ ok: true, body: "Anyone going to the fair?" });
    expect(validatePostBody("a".repeat(POST_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(validatePostBody("line one\r\nline two")).toEqual({ ok: true, body: "line one\nline two" });
  });

  it("rejects empty, too long, non-text and offensive posts", () => {
    expect(validatePostBody("   ")).toEqual({ ok: false, error: "invalid_post" });
    expect(validatePostBody("a".repeat(POST_MAX_LENGTH + 1))).toEqual({ ok: false, error: "invalid_post" });
    expect(validatePostBody(42)).toEqual({ ok: false, error: "invalid_post" });
    expect(validatePostBody("this plan is 4ucking dumb")).toEqual({ ok: false, error: "post_blocked" });
    expect(validatePostBody("s*x")).toEqual({ ok: false, error: "post_blocked" });
  });

  it("shortens names like the rest of Docket", () => {
    expect(shortName("Maria Lopez")).toBe("Maria L.");
    expect(shortName("Priya A.")).toBe("Priya A.");
    expect(shortName("Cher")).toBe("Cher");
  });
});

describe("sample posts", () => {
  it("are clean, within limits, in real neighborhoods and answered by other neighbors", () => {
    expect(SAMPLE_POSTS.length).toBeGreaterThanOrEqual(12);
    for (const post of SAMPLE_POSTS) {
      expect(moderateText(post.body).ok, post.body).toBe(true);
      expect(post.body.length).toBeLessThanOrEqual(POST_MAX_LENGTH);
      expect(post.author).toBeLessThan(100);
      if (post.neighborhood) expect(areaBySlug(post.neighborhood), post.neighborhood).toBeDefined();
      for (const reply of post.replies) {
        expect(moderateText(reply.body).ok, reply.body).toBe(true);
        expect(reply.author).not.toBe(post.author);
        // Replies land after their post but never in the future.
        expect(reply.minutesAfter, post.body).toBeLessThan(post.hoursAgo * 60);
      }
    }
    const ids = [...SAMPLE_POSTS.map((_, i) => samplePostId(i)), ...SAMPLE_POSTS.flatMap((p, i) => p.replies.map((_, r) => sampleReplyId(i, r)))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("use the seed's sample member names and home neighborhoods", () => {
    expect(sampleMemberName(0)).toBe("Priya A.");
    expect(sampleMemberHome(0)).toBe("Niles");
    expect(sampleMemberHome(1)).toBe("Irvington");
  });

  it("build newest-first feeds for all of Fremont or chosen neighborhoods", () => {
    const all = sampleFeed(NOW, null);
    expect(all).toHaveLength(SAMPLE_POSTS.length);
    expect(Date.parse(all[0].createdAt)).toBeGreaterThan(Date.parse(all[1].createdAt));
    expect(all.some((p) => p.neighborhood === null)).toBe(true);
    const niles = sampleFeed(NOW, ["niles"]);
    expect(niles.length).toBeGreaterThan(0);
    expect(niles.every((p) => p.neighborhood?.slug === "niles")).toBe(true);
    expect(sampleFeed(NOW, [])).toEqual([]);
  });

  it("serve replies for a sample post, after the post, in its neighborhood", () => {
    const first = sampleFeed(NOW, null)[0];
    const replies = sampleReplies(first.id, NOW);
    expect(replies).toHaveLength(first.replyCount);
    expect(replies.every((r) => r.parentId === first.id && r.neighborhood?.slug === first.neighborhood?.slug)).toBe(true);
    expect(Date.parse(replies[0].createdAt)).toBeGreaterThan(Date.parse(first.createdAt));
    expect(sampleReplies("00000000-0000-4000-9000-999999999999", NOW)).toEqual([]);
  });
});
