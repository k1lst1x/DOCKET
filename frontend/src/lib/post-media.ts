// Photos, videos and links in home feed posts. Shared by the API and the browser, so it has no
// server-only imports. Uploads go straight from the browser to the private media bucket; these
// rules decide what an upload ticket may be issued for and what a new post may reference.

export type PostMediaKind = "image" | "video";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 5 * 60;
const MAX_DIMENSION = 20_000;

/**
 * Upload types Docket stores, and the file extension each is stored under. These are the formats the
 * automatic content check (Amazon Rekognition) can read: JPEG and PNG photos, MP4 and MOV videos.
 */
export const MEDIA_TYPES: Record<string, { kind: PostMediaKind; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
};

/** Photo types the post box converts to JPEG before uploading (a GIF keeps its first frame). */
export const CONVERTIBLE_IMAGE_TYPES = ["image/webp", "image/gif"];

/** What the file picker offers. */
export const ACCEPT_MEDIA = [...Object.keys(MEDIA_TYPES), ...CONVERTIBLE_IMAGE_TYPES].join(",");

/** The content check needs photos at least this many pixels on each side. */
export const MIN_IMAGE_DIMENSION = 80;

export const maxBytes = (kind: PostMediaKind) => (kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);

/** A stored upload, as saved in posts.media. */
export interface StoredMedia {
  kind: PostMediaKind;
  key: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  durationS: number | null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function mediaKey(memberId: string, id: string, contentType: string): string {
  return `uploads/${memberId}/${id}.${MEDIA_TYPES[contentType].ext}`;
}

const isDimension = (n: unknown) => n === null || n === undefined || (Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_DIMENSION);

/** Checks a request for an upload ticket: { contentType, size, durationS? }. */
export function validateUploadRequest(raw: unknown): { ok: true; kind: PostMediaKind; contentType: string; size: number } | { ok: false } {
  if (!raw || typeof raw !== "object") return { ok: false };
  const { contentType, size, durationS } = raw as Record<string, unknown>;
  const type = typeof contentType === "string" ? MEDIA_TYPES[contentType] : undefined;
  if (!type || typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > maxBytes(type.kind)) return { ok: false };
  if (type.kind === "video" && !(typeof durationS === "number" && durationS > 0 && durationS <= MAX_VIDEO_SECONDS)) return { ok: false };
  return { ok: true, kind: type.kind, contentType: contentType as string, size };
}

/**
 * Checks the media list of a new post: up to four photos or one video, each an upload in the
 * poster's own folder. Sizes are confirmed against the bucket afterwards.
 */
export function validatePostMedia(raw: unknown, memberId: string): { ok: true; media: Omit<StoredMedia, "size">[] } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, media: [] };
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return { ok: false };
  const keyPattern = new RegExp(`^uploads/${memberId.replace(/[^0-9a-zA-Z-]/g, "")}/${UUID}\\.(jpg|png|mp4|mov)$`);
  const media: Omit<StoredMedia, "size">[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false };
    const { key, contentType, width, height, durationS } = item as Record<string, unknown>;
    const type = typeof contentType === "string" ? MEDIA_TYPES[contentType] : undefined;
    if (!type || typeof key !== "string" || !keyPattern.test(key) || !key.endsWith(`.${type.ext}`)) return { ok: false };
    if (!isDimension(width) || !isDimension(height)) return { ok: false };
    if (type.kind === "video" && !(typeof durationS === "number" && durationS > 0 && durationS <= MAX_VIDEO_SECONDS)) return { ok: false };
    media.push({
      kind: type.kind,
      key,
      contentType: contentType as string,
      width: (width as number | undefined) ?? null,
      height: (height as number | undefined) ?? null,
      durationS: type.kind === "video" ? Math.round((durationS as number) * 10) / 10 : null,
    });
  }
  const videos = media.filter((m) => m.kind === "video").length;
  if (videos > 1 || (videos === 1 && media.length > 1)) return { ok: false };
  if (new Set(media.map((m) => m.key)).size !== media.length) return { ok: false };
  return { ok: true, media };
}

// ---- Links -------------------------------------------------------------------------------------

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"]*/gi;
const TRAILING = /[.,!?;:'")\]]+$/;
/** Links with any scheme other than http(s), and script or data URLs. */
const BLOCKED_LINK = /\b(?!https?:)[a-z][a-z0-9+.-]*:\/\/|\b(?:javascript|vbscript):|\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i;

export type TextPart = { type: "text"; text: string } | { type: "link"; text: string; href: string; host: string };

/** True when the text holds a link Docket won't publish (only http and https links are allowed). */
export function hasBlockedLink(text: string): boolean {
  return BLOCKED_LINK.test(text);
}

function toHref(raw: string): { href: string; host: string } | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    return { href: url.href, host: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/** Splits post text into plain text and http(s) links, for rendering links as anchors. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let raw = match[0];
    // Keep closing punctuation out of the link, except a ")" that closes a "(" inside it.
    while (TRAILING.test(raw)) {
      const end = raw.at(-1);
      if (end === ")" && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) break;
      raw = raw.slice(0, -1);
    }
    const link = raw ? toHref(raw) : null;
    const start = match.index ?? 0;
    if (!link) continue;
    if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
    parts.push({ type: "link", text: raw, ...link });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
