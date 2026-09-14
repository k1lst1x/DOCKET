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

interface Policy {
  /** Null means allowed. */
  reason: ReviewReason | null;
  /** Minimum Rekognition confidence (0-100) to block. */
  min: number;
}

const block = (reason: ReviewReason, min: number): Policy => ({ reason, min });
const ALLOW: Policy = { reason: null, min: Infinity };

/**
 * Every label in Rekognition's content moderation taxonomy, with what Docket does about it. Model 7
 * names come from AWS's published label list (rekognition-moderation-labels.csv); model 6 names are
 * kept because older video results can still use them. Names match without regard to case.
 */
const LABEL_POLICY: [string, Policy][] = [
  // Explicit (model 7)
  ["Explicit", block("sexual", 60)],
  ["Explicit Nudity", block("sexual", 60)],
  ["Exposed Male Genitalia", block("sexual", 60)],
  ["Exposed Female Genitalia", block("sexual", 60)],
  ["Exposed Buttocks or Anus", block("sexual", 60)],
  ["Exposed Female Nipple", block("sexual", 60)],
  ["Explicit Sexual Activity", block("sexual", 60)],
  ["Sex Toys", block("sexual", 60)],
  // Non-explicit nudity and kissing: partial or covered-up nudity blocks; bare backs, shirtless men and kissing don't.
  ["Non-Explicit Nudity of Intimate parts and Kissing", ALLOW],
  ["Non-Explicit Nudity", ALLOW],
  ["Bare Back", ALLOW],
  ["Exposed Male Nipple", ALLOW],
  ["Partially Exposed Buttocks", block("nudity", 80)],
  ["Partially Exposed Female Breast", block("nudity", 80)],
  ["Implied Nudity", block("nudity", 80)],
  ["Obstructed Intimate Parts", block("nudity", 80)],
  ["Obstructed Female Nipple", block("nudity", 80)],
  ["Obstructed Male Genitalia", block("nudity", 80)],
  ["Kissing on the Lips", ALLOW],
  // Swimwear or underwear: beach days and pool openings.
  ["Swimwear or Underwear", ALLOW],
  ["Female Swimwear or Underwear", ALLOW],
  ["Male Swimwear or Underwear", ALLOW],
  // Violence: violence blocks. A weapon on its own (a safety report) and fire or explosions (a house fire,
  // fireworks) are allowed, even though Rekognition files explosions under Graphic Violence.
  ["Violence", ALLOW],
  ["Weapons", ALLOW],
  ["Graphic Violence", block("violence", 80)],
  ["Weapon Violence", block("violence", 80)],
  ["Physical Violence", block("violence", 80)],
  ["Self-Harm", block("violence", 80)],
  ["Blood & Gore", block("violence", 80)],
  ["Explosions and Blasts", ALLOW],
  // Visually disturbing
  ["Visually Disturbing", block("disturbing", 80)],
  ["Death and Emaciation", block("disturbing", 80)],
  ["Emaciated Bodies", block("disturbing", 80)],
  ["Corpses", block("disturbing", 80)],
  ["Crashes", block("disturbing", 80)],
  ["Air Crash", block("disturbing", 80)],
  // Drugs & tobacco: model 7 only recognizes pills and smoking, which ordinary posts show (a pharmacy, a smoke-free park).
  ["Drugs & Tobacco", ALLOW],
  ["Products", ALLOW],
  ["Pills", ALLOW],
  ["Drugs & Tobacco Paraphernalia & Use", ALLOW],
  ["Smoking", ALLOW],
  // Alcohol and gambling: restaurants, breweries, a casino night fundraiser.
  ["Alcohol", ALLOW],
  ["Alcohol Use", ALLOW],
  ["Drinking", ALLOW],
  ["Alcoholic Beverages", ALLOW],
  ["Gambling", ALLOW],
  // Rude gestures and hate symbols
  ["Rude Gestures", block("gesture", 80)],
  ["Middle Finger", block("gesture", 80)],
  ["Hate Symbols", block("hate", 60)],
  ["Nazi Party", block("hate", 60)],
  ["White Supremacy", block("hate", 60)],
  ["Extremist", block("hate", 60)],
  // Model 6 names
  ["Nudity", block("sexual", 60)],
  ["Graphic Male Nudity", block("sexual", 60)],
  ["Graphic Female Nudity", block("sexual", 60)],
  ["Sexual Activity", block("sexual", 60)],
  ["Illustrated Explicit Nudity", block("sexual", 60)],
  ["Adult Toys", block("sexual", 60)],
  ["Suggestive", ALLOW],
  ["Partial Nudity", block("nudity", 80)],
  ["Barechested Male", ALLOW],
  ["Revealing Clothes", ALLOW],
  ["Sexual Situations", block("sexual", 80)],
  ["Graphic Violence Or Gore", block("violence", 80)],
  ["Self Injury", block("violence", 80)],
  ["Hanging", block("disturbing", 80)],
  ["Drugs", ALLOW],
  ["Drug Products", ALLOW],
  ["Drug Use", block("drugs", 80)],
  ["Drug Paraphernalia", block("drugs", 85)],
  ["Tobacco", ALLOW],
  ["Tobacco Products", ALLOW],
];

/**
 * For a label name Docket doesn't know yet (AWS adds labels over time), what its parent category
 * implies. Categories where anything new is likely harmful block; mixed ones block only when
 * Rekognition is very sure; harmless ones stay allowed.
 */
const UNKNOWN_CHILD_OF: [string, Policy][] = [
  ["Explicit", block("sexual", 60)],
  ["Explicit Nudity", block("sexual", 60)],
  ["Non-Explicit Nudity of Intimate parts and Kissing", block("nudity", 90)],
  ["Non-Explicit Nudity", block("nudity", 90)],
  ["Obstructed Intimate Parts", block("nudity", 80)],
  ["Suggestive", block("nudity", 90)],
  ["Violence", block("violence", 90)],
  ["Graphic Violence", block("violence", 80)],
  ["Visually Disturbing", block("disturbing", 80)],
  ["Death and Emaciation", block("disturbing", 80)],
  ["Crashes", block("disturbing", 80)],
  ["Drugs & Tobacco", block("drugs", 90)],
  ["Products", block("drugs", 90)],
  ["Drugs & Tobacco Paraphernalia & Use", block("drugs", 90)],
  ["Drugs", block("drugs", 90)],
  ["Rude Gestures", block("gesture", 80)],
  ["Hate Symbols", block("hate", 60)],
  ["Swimwear or Underwear", ALLOW],
  ["Alcohol", ALLOW],
  ["Gambling", ALLOW],
  ["Tobacco", ALLOW],
];

const key = (name: string | undefined) => (name ?? "").trim().toLowerCase();
const POLICY = new Map(LABEL_POLICY.map(([name, policy]) => [key(name), policy]));
const FALLBACK = new Map(UNKNOWN_CHILD_OF.map(([name, policy]) => [key(name), policy]));

const policyFor = (label: ModerationLabelLike): Policy | undefined => POLICY.get(key(label.Name)) ?? FALLBACK.get(key(label.ParentName));

/**
 * Reasons to block, from the moderation labels Rekognition returned for one picture (or one moment of
 * a video). Empty means nothing Docket blocks was found. Rekognition returns a label's parent
 * categories alongside it; when a specific label is allowed (explosions under Graphic Violence), its
 * parent doesn't block on that label's behalf. A blocked specific label still blocks.
 */
export function judgeLabels(labels: ModerationLabelLike[]): ReviewReason[] {
  const coveredByAllowedChild = new Set(labels.filter((l) => policyFor(l)?.reason === null && key(l.ParentName)).map((l) => key(l.ParentName)));
  const blockedChildOf = new Set(labels.filter((l) => policyFor(l)?.reason && key(l.ParentName)).map((l) => key(l.ParentName)));
  const reasons = new Set<ReviewReason>();
  for (const label of labels) {
    const name = key(label.Name);
    if (!name) continue;
    if (coveredByAllowedChild.has(name) && !blockedChildOf.has(name)) continue;
    const policy = policyFor(label);
    if (policy?.reason && (label.Confidence ?? 0) >= policy.min) reasons.add(policy.reason);
  }
  return [...reasons];
}

/** A video's labels, judged moment by moment so an allowed label at one moment can't excuse another. */
export function judgeVideoLabels(detections: { Timestamp?: number; ModerationLabel?: ModerationLabelLike }[]): ReviewReason[] {
  const moments = new Map<number, ModerationLabelLike[]>();
  for (const detection of detections) {
    if (!detection.ModerationLabel) continue;
    const at = detection.Timestamp ?? -1;
    moments.set(at, [...(moments.get(at) ?? []), detection.ModerationLabel]);
  }
  return [...new Set([...moments.values()].flatMap((labels) => judgeLabels(labels)))];
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
