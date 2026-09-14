import { describe, expect, it } from "vitest";
import { judgeLabels, judgeText, reviewNotice, sniffContentType, sniffMatches } from "./media-moderation";

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR");
const MP4 = bytes(0, 0, 0, 0x20, "ftypisom", 0, 0, 2, 0);
const MOV = bytes(0, 0, 0, 0x14, "ftypqt  ", 0, 0, 0, 0);
const OLD_MOV = bytes(0, 0, 0, 0x08, "wide", 0, 0, 0, 0);
const HEIC = bytes(0, 0, 0, 0x18, "ftypheic", 0, 0, 0, 0);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81);
const HTML = bytes("<!doctype html><script>alert(1)</script>");
const EXE = bytes("MZ", 0x90, 0, 3, 0, 0, 0);
const PDF = bytes("%PDF-1.7");

describe("file signatures", () => {
  it("recognize real photos and videos", () => {
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(bytes("GIF89a", 1, 0))).toBe("image/gif");
    expect(sniffContentType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffContentType(MP4)).toBe("video/mp4");
    expect(sniffContentType(MOV)).toBe("video/quicktime");
    expect(sniffContentType(OLD_MOV)).toBe("video/quicktime");
    expect(sniffContentType(HEIC)).toBe("image/heic");
    expect(sniffContentType(WEBM)).toBe("video/webm");
  });

  it("don't recognize web pages, programs, documents or empty files", () => {
    expect(sniffContentType(HTML)).toBeNull();
    expect(sniffContentType(EXE)).toBeNull();
    expect(sniffContentType(PDF)).toBeNull();
    expect(sniffContentType(new Uint8Array())).toBeNull();
    expect(sniffContentType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("catch files disguised as another type", () => {
    expect(sniffMatches("image/jpeg", JPEG)).toBe(true);
    expect(sniffMatches("image/png", PNG)).toBe(true);
    expect(sniffMatches("image/png", JPEG)).toBe(false);
    expect(sniffMatches("image/png", HTML)).toBe(false);
    expect(sniffMatches("image/jpeg", EXE)).toBe(false);
    expect(sniffMatches("video/mp4", HEIC)).toBe(false);
    expect(sniffMatches("video/mp4", WEBM)).toBe(false);
    // MP4 and MOV share a container; browsers label them loosely.
    expect(sniffMatches("video/mp4", MOV)).toBe(true);
    expect(sniffMatches("video/quicktime", MP4)).toBe(true);
  });
});

describe("moderation labels", () => {
  it("block explicit content, nudity, graphic violence, hate symbols, rude gestures and drug use", () => {
    expect(judgeLabels([{ Name: "Explicit Nudity", ParentName: "Explicit", Confidence: 72 }])).toEqual(["sexual"]);
    expect(judgeLabels([{ Name: "Exposed Male Genitalia", Confidence: 61 }])).toEqual(["sexual"]);
    expect(judgeLabels([{ Name: "Obstructed Intimate Parts", Confidence: 88 }])).toEqual(["nudity"]);
    expect(judgeLabels([{ Name: "Blood & Gore", ParentName: "Violence", Confidence: 91 }])).toEqual(["violence"]);
    expect(judgeLabels([{ Name: "Corpses", Confidence: 83 }])).toEqual(["disturbing"]);
    expect(judgeLabels([{ Name: "Nazi Party", ParentName: "Hate Symbols", Confidence: 64 }])).toEqual(["hate"]);
    expect(judgeLabels([{ Name: "Middle Finger", ParentName: "Rude Gestures", Confidence: 97 }])).toEqual(["gesture"]);
    expect(judgeLabels([{ Name: "Drug Paraphernalia", Confidence: 90 }])).toEqual(["drugs"]);
  });

  it("allow what a neighborhood feed shows every day, and low-confidence guesses", () => {
    const everyday = [
      { Name: "Kissing on the Lips", ParentName: "Non-Explicit Nudity of Intimate parts and Kissing", Confidence: 99 },
      { Name: "Non-Explicit Nudity of Intimate parts and Kissing", Confidence: 99 },
      { Name: "Swimwear or Underwear", Confidence: 98 },
      { Name: "Female Swimwear Or Underwear", Confidence: 95 },
      { Name: "Bare Back", Confidence: 96 },
      { Name: "Weapons", ParentName: "Violence", Confidence: 97 },
      { Name: "Violence", Confidence: 97 },
      { Name: "Drugs & Tobacco", Confidence: 94 },
      { Name: "Smoking", ParentName: "Drugs & Tobacco", Confidence: 94 },
      { Name: "Alcohol", Confidence: 99 },
      { Name: "Gambling", Confidence: 90 },
      { Name: "Explosions and Blasts", Confidence: 90 },
    ];
    expect(judgeLabels(everyday)).toEqual([]);
    expect(judgeLabels([{ Name: "Explicit Nudity", Confidence: 55 }])).toEqual([]);
    expect(judgeLabels([{ Name: "Graphic Violence", Confidence: 79.9 }])).toEqual([]);
    expect(judgeLabels([{ Confidence: 99 }, {}])).toEqual([]);
  });

  it("list each reason once", () => {
    expect(
      judgeLabels([
        { Name: "Explicit", Confidence: 99 },
        { Name: "Explicit Nudity", Confidence: 98 },
        { Name: "Hate Symbols", Confidence: 70 },
      ]),
    ).toEqual(["sexual", "hate"]);
  });
});

describe("words in photos", () => {
  it("run through the post language filter, including disguised spellings", () => {
    expect(judgeText(["FARMERS MARKET", "SATURDAY 9-1"])).toEqual([]);
    expect(judgeText([])).toEqual([]);
    expect(judgeText(["f*ck the", "city council"])).toEqual(["language"]);
    expect(judgeText(["4UCK THIS"])).toEqual(["language"]);
  });
});

describe("notices", () => {
  it("explain results to the poster without telling neighbors anything", () => {
    expect(reviewNotice("image", "approved", [], "composer")).toBeNull();
    expect(reviewNotice("image", "blocked", ["sexual", "hate"], "composer")).toBe(
      "This photo can't be posted because it appears to show sexual content or nudity and a hate symbol. Remove it to post.",
    );
    expect(reviewNotice("video", "blocked", ["violence"], "author")).toBe("Only you can see this. Your video was removed because it appears to show graphic violence.");
    expect(reviewNotice("image", "blocked", ["not_media"], "composer")).toBe("That file isn't a real photo, so it can't be posted.");
    expect(reviewNotice("video", "failed", ["unreadable"], "author")).toContain("MP4 (H.264)");
    expect(reviewNotice("video", "pending", [], "author")).toContain("Only you can see this video");
  });
});
