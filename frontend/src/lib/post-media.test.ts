import { describe, expect, it, vi } from "vitest";
import { formatDuration, hasBlockedLink, linkify, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, mediaKey, validatePostMedia, validateUploadRequest } from "./post-media";
import { createPost } from "./posts";
import { POST_MAX_LENGTH, validatePostBody } from "./posts-shared";

// createPost must reject bad text and media before touching the database or the bucket.
vi.mock("./db", () => ({
  db: () => {
    throw new Error("database should not be reached");
  },
}));
vi.mock("./media-storage", () => ({
  mediaBucket: () => "test-bucket",
  confirmUploads: () => {
    throw new Error("bucket should not be reached");
  },
  viewUrl: async () => null,
}));

const MEMBER = "3b1f7c1e-8a52-4d7e-9c1a-2f6e4b9d0a11";
const OTHER = "9e2d4c6a-1b3f-4a5e-8d7c-0f1e2d3c4b5a";
const key = (ext: string, member = MEMBER) => `uploads/${member}/0b6a4f2e-7c1d-4e8a-9b3f-5d2c1a0e9f87.${ext}`;
const key2 = (ext: string) => `uploads/${MEMBER}/1c7b5a3f-8d2e-4f9b-a04c-6e3d2b1f0a98.${ext}`;

describe("upload tickets", () => {
  it("accept photos and videos within the limits", () => {
    expect(validateUploadRequest({ contentType: "image/jpeg", size: 2_000_000 })).toMatchObject({ ok: true, kind: "image" });
    expect(validateUploadRequest({ contentType: "image/gif", size: MAX_IMAGE_BYTES })).toMatchObject({ ok: true });
    expect(validateUploadRequest({ contentType: "video/mp4", size: 80_000_000, durationS: 299.6 })).toMatchObject({ ok: true, kind: "video" });
    expect(validateUploadRequest({ contentType: "video/quicktime", size: MAX_VIDEO_BYTES, durationS: 300 })).toMatchObject({ ok: true });
  });

  it("refuse other types, oversized files and videos over five minutes", () => {
    expect(validateUploadRequest({ contentType: "image/svg+xml", size: 100 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "text/html", size: 100 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "image/png", size: MAX_IMAGE_BYTES + 1 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "video/mp4", size: MAX_VIDEO_BYTES + 1, durationS: 60 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "video/mp4", size: 1000, durationS: 300.5 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "video/mp4", size: 1000 })).toEqual({ ok: false });
    expect(validateUploadRequest({ contentType: "image/png", size: 0 })).toEqual({ ok: false });
    expect(validateUploadRequest(null)).toEqual({ ok: false });
  });

  it("store uploads in the member's own folder", () => {
    expect(mediaKey(MEMBER, "abc", "video/quicktime")).toBe(`uploads/${MEMBER}/abc.mov`);
  });
});

describe("post media", () => {
  it("allows no media, up to four photos, or one video", () => {
    expect(validatePostMedia(undefined, MEMBER)).toEqual({ ok: true, media: [] });
    const photos = validatePostMedia(
      [
        { key: key("jpg"), contentType: "image/jpeg", width: 1200, height: 800 },
        { key: key2("png"), contentType: "image/png" },
      ],
      MEMBER,
    );
    expect(photos).toMatchObject({ ok: true, media: [{ kind: "image", width: 1200, durationS: null }, { kind: "image", width: null }] });
    expect(validatePostMedia([{ key: key("mp4"), contentType: "video/mp4", width: 1920, height: 1080, durationS: 42.349 }], MEMBER)).toMatchObject({
      ok: true,
      media: [{ kind: "video", durationS: 42.3 }],
    });
  });

  it("rejects other members' files, mismatched types, mixes, duplicates and long videos", () => {
    expect(validatePostMedia([{ key: key("jpg", OTHER), contentType: "image/jpeg" }], MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia([{ key: key("png"), contentType: "image/jpeg" }], MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia([{ key: "uploads/../secret.jpg", contentType: "image/jpeg" }], MEMBER)).toEqual({ ok: false });
    expect(
      validatePostMedia(
        [
          { key: key("mp4"), contentType: "video/mp4", durationS: 10 },
          { key: key2("jpg"), contentType: "image/jpeg" },
        ],
        MEMBER,
      ),
    ).toEqual({ ok: false });
    expect(validatePostMedia([{ key: key("jpg"), contentType: "image/jpeg" }, { key: key("jpg"), contentType: "image/jpeg" }], MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia([{ key: key("mp4"), contentType: "video/mp4", durationS: 301 }], MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia(new Array(5).fill({ key: key("jpg"), contentType: "image/jpeg" }), MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia([{ key: key("jpg"), contentType: "image/jpeg", width: -3 }], MEMBER)).toEqual({ ok: false });
    expect(validatePostMedia("uploads/x.jpg", MEMBER)).toEqual({ ok: false });
  });
});

describe("links", () => {
  it("turns http(s) and www links into anchors, leaving punctuation outside", () => {
    expect(linkify("See https://fremont.gov/meetings, then reply.")).toEqual([
      { type: "text", text: "See " },
      { type: "link", text: "https://fremont.gov/meetings", href: "https://fremont.gov/meetings", host: "fremont.gov" },
      { type: "text", text: ", then reply." },
    ]);
    expect(linkify("(www.acgov.org/vote)")[1]).toMatchObject({ type: "link", href: "https://www.acgov.org/vote", host: "acgov.org" });
    expect(linkify("https://en.wikipedia.org/wiki/Fremont_(disambiguation)")[0]).toMatchObject({ text: "https://en.wikipedia.org/wiki/Fremont_(disambiguation)" });
    expect(linkify("no links here 🎉")).toEqual([{ type: "text", text: "no links here 🎉" }]);
    expect(linkify("javascript:alert(1)").every((p) => p.type === "text")).toBe(true);
  });

  it("flags links that aren't http or https", () => {
    expect(hasBlockedLink("javascript:alert(1)")).toBe(true);
    expect(hasBlockedLink("ftp://files.example.com")).toBe(true);
    expect(hasBlockedLink("open data:text/html;base64,PHNjcmlwdD4=")).toBe(true);
    expect(hasBlockedLink("https://fremont.gov and www.example.com")).toBe(false);
    expect(hasBlockedLink("Updated data: 5 people came")).toBe(false);
  });

  it("post text allows media-only posts and blocks bad links", () => {
    expect(validatePostBody("", { allowEmpty: true })).toEqual({ ok: true, body: "" });
    expect(validatePostBody(undefined, { allowEmpty: true })).toEqual({ ok: true, body: "" });
    expect(validatePostBody("")).toEqual({ ok: false, error: "invalid_post" });
    // The database no longer checks length, so the 500-character cap holds with or without media.
    expect(validatePostBody("a".repeat(POST_MAX_LENGTH + 1), { allowEmpty: true })).toEqual({ ok: false, error: "invalid_post" });
    expect(validatePostBody("a".repeat(POST_MAX_LENGTH), { allowEmpty: true })).toMatchObject({ ok: true });
    expect(validatePostBody(42, { allowEmpty: true })).toEqual({ ok: false, error: "invalid_post" });
    expect(validatePostBody("click javascript:alert(1)")).toEqual({ ok: false, error: "link_blocked" });
    expect(validatePostBody("Farmers market today 🍓 https://fremont.gov/market")).toMatchObject({ ok: true });
  });

  it("createPost refuses empty or overlong posts and replies, and media on replies, before saving", async () => {
    const parentId = "5f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
    const photo = [{ key: key("jpg"), contentType: "image/jpeg" }];
    const code = (input: Parameters<typeof createPost>[1]) => createPost(MEMBER, input).catch((e: { code?: string }) => e.code);

    await expect(code({ body: "", neighborhood: null, parentId: null })).resolves.toBe("invalid_post");
    await expect(code({ body: "a".repeat(POST_MAX_LENGTH + 1), neighborhood: null, parentId: null })).resolves.toBe("invalid_post");
    await expect(code({ body: "a".repeat(POST_MAX_LENGTH + 1), neighborhood: null, parentId: null, media: photo })).resolves.toBe("invalid_post");
    // Replies: text only, 1–500 characters.
    await expect(code({ body: "   ", neighborhood: null, parentId })).resolves.toBe("invalid_post");
    await expect(code({ body: "a".repeat(POST_MAX_LENGTH + 1), neighborhood: null, parentId })).resolves.toBe("invalid_post");
    await expect(code({ body: "", neighborhood: null, parentId, media: photo })).resolves.toBe("media_invalid");
    await expect(code({ body: "nice", neighborhood: null, parentId, media: photo })).resolves.toBe("media_invalid");
  });

  it("formats video lengths", () => {
    expect(formatDuration(299.6)).toBe("5:00");
    expect(formatDuration(42)).toBe("0:42");
  });
});
