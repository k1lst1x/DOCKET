import { moderateText } from "./moderation";
import type { PostMediaKind } from "./post-media";

// What Docket won't show in photos and videos, and how to explain it. Shared by the server (which
// asks Amazon Rekognition what an upload contains) and the browser (which shows the result), so it
// has no server-only imports.

export type ReviewStatus = "pending" | "approved" | "blocked" | "failed";
export type ReviewReason = "sexual" | "nudity" | "violence" | "disturbing" | "hate" | "gesture" | "drugs" | "language" | "not_media" | "unreadable";

/** The parts of a Rekognition moderation label the rules read. */
export interface ModerationLabelLike {
  Name?: string;
  ParentName?: string;
  Confidence?: number;
}

interface Rule {
  reason: ReviewReason;
  /** Minimum Rekognition confidence (0-100) to block. */
  min: number;
  /** Label names, from Rekognition's current (v7) and older (v6) moderation taxonomies. */
  names: string[];
}

// Rules match a label's own name only, never its parent: a parent such as "Violence" or
// "Drugs & Tobacco" also covers things a neighborhood feed allows (weapons in a safety report,
// smoking, alcohol, swimwear, kissing), so only the specific labels below block.
export const MEDIA_RULES: Rule[] = [
  {
    reason: "sexual",
    min: 60,
    names: [
      "Explicit",
      "Explicit Nudity",
      "Explicit Sexual Activity",
      "Sexual Activity",
      "Sex Toys",
      "Adult Toys",
      "Exposed Female Genitalia",
      "Exposed Male Genitalia",
      "Exposed Buttocks or Anus",
      "Exposed Female Nipple",
      "Graphic Female Nudity",
      "Graphic Male Nudity",
      "Illustrated Explicit Nudity",
      "Sexual Situations",
    ],
  },
  {
    reason: "nudity",
    min: 80,
    names: ["Nudity", "Partial Nudity", "Implied Nudity", "Obstructed Intimate Parts", "Obstructed Female Nipple", "Obstructed Male Genitalia", "Partially Exposed Buttocks", "Partially Exposed Female Breast"],
  },
  { reason: "violence", min: 80, names: ["Graphic Violence", "Graphic Violence Or Gore", "Physical Violence", "Weapon Violence", "Self-Harm", "Self Injury", "Blood & Gore"] },
  { reason: "disturbing", min: 80, names: ["Corpses", "Emaciated Bodies", "Death and Emaciation", "Hanging", "Air Crash"] },
  { reason: "hate", min: 60, names: ["Hate Symbols", "Nazi Party", "White Supremacy", "Extremist"] },
  { reason: "gesture", min: 80, names: ["Rude Gestures", "Middle Finger"] },
  { reason: "drugs", min: 85, names: ["Drug Use", "Drug Paraphernalia"] },
];

const RULE_BY_NAME = new Map(MEDIA_RULES.flatMap((rule) => rule.names.map((name) => [name.toLowerCase(), rule] as const)));

/** Reasons to block, from Rekognition moderation labels. Empty means nothing Docket blocks was found. */
export function judgeLabels(labels: ModerationLabelLike[]): ReviewReason[] {
  const reasons = new Set<ReviewReason>();
  for (const label of labels) {
    const rule = RULE_BY_NAME.get((label.Name ?? "").trim().toLowerCase());
    if (rule && (label.Confidence ?? 0) >= rule.min) reasons.add(rule.reason);
  }
  return [...reasons];
}

/** Words in a photo (Rekognition text detection) go through the same language filter as posts. */
export function judgeText(lines: string[]): ReviewReason[] {
  const text = lines.map((line) => line.trim()).filter(Boolean);
  if (!text.length) return [];
  return !moderateText(text.join("\n")).ok || text.some((line) => !moderateText(line).ok) ? ["language"] : [];
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis"]);

/**
 * The real type of a file from its first bytes, whatever its name or declared type says. Only the
 * formats Docket might receive are recognized; anything else (HTML, scripts, programs, PDFs) is null.
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const ascii = (start: number, length: number) => (bytes.length >= start + length ? String.fromCharCode(...bytes.subarray(start, start + length)) : "");
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return "image/png";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (HEIF_BRANDS.has(brand)) return "image/heic";
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // Older QuickTime files start with an atom other than ftyp.
  if (["moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 4))) return "video/quicktime";
  return null;
}

/** True when the file really is the declared type. MP4 and MOV share a container, so either passes for the other. */
export function sniffMatches(declared: string, bytes: Uint8Array): boolean {
  const found = sniffContentType(bytes);
  if (!found) return false;
  const isVideo = (type: string) => type === "video/mp4" || type === "video/quicktime";
  return found === declared || (isVideo(found) && isVideo(declared));
}

const REASON_TEXT: Record<Exclude<ReviewReason, "not_media" | "unreadable">, string> = {
  sexual: "sexual content or nudity",
  nudity: "nudity",
  violence: "graphic violence",
  disturbing: "disturbing images",
  hate: "a hate symbol",
  gesture: "a rude gesture",
  drugs: "drug use",
  language: "words Docket doesn't allow",
};

const listOf = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * What to tell someone about a check result: "composer" while they're writing a post, "author" on
 * their own post in the feed (neighbors never see files that aren't approved). Null when there's
 * nothing to say.
 */
export function reviewNotice(kind: PostMediaKind, status: ReviewStatus, reasons: string[], audience: "composer" | "author"): string | null {
  const noun = kind === "video" ? "video" : "photo";
  const onlyYou = audience === "author" ? "Only you can see this. " : "";
  if (status === "approved") return null;
  if (status === "pending") {
    return audience === "composer"
      ? "Neighbors will see this video after Docket's automatic check, usually within a couple of minutes."
      : "Only you can see this video until Docket's automatic check finishes, usually within a couple of minutes.";
  }
  if (status === "failed" || reasons.includes("unreadable")) {
    const hint = kind === "video" ? "Try saving it as an MP4 (H.264) under 5 minutes." : "Try a JPEG or PNG at least 80 pixels wide.";
    return `${onlyYou}Docket couldn't check this ${noun}, so neighbors can't see it. ${hint}`;
  }
  if (reasons.includes("not_media")) return `${onlyYou}That file isn't a real ${noun}, so it can't be posted.`;
  const shown = listOf(reasons.flatMap((r) => (r in REASON_TEXT ? [REASON_TEXT[r as keyof typeof REASON_TEXT]] : [])));
  return audience === "composer"
    ? `This ${noun} can't be posted because it appears to show ${shown || "content Docket doesn't allow"}. Remove it to post.`
    : `${onlyYou}Your ${noun} was removed because it appears to show ${shown || "content Docket doesn't allow"}.`;
}
