import {
  DetectModerationLabelsCommand,
  DetectTextCommand,
  GetContentModerationCommand,
  RekognitionClient,
  StartContentModerationCommand,
  type ModerationLabel,
} from "@aws-sdk/client-rekognition";
import { createHash } from "node:crypto";
import { db } from "./db";
import { judgeLabels, judgeText, sniffMatches, type ReviewReason, type ReviewStatus } from "./media-moderation";
import { mediaBucket, readFileStart, setUploadState } from "./media-storage";
import type { PostMediaKind } from "./post-media";

// Automatic content checks for photos and videos in posts, with Amazon Rekognition.
// - Every upload's first bytes must match its declared type (no disguised files).
// - Photos: moderation labels plus the words in the picture, checked right away.
// - Videos: a Rekognition content moderation job; its result is collected when the feed or the
//   poster next asks, so no queue or webhook is needed.
// Results live in media_reviews, one row per file. Neighbors only ever see approved files. A file
// that can't be checked counts as not approved. Blocked files are tagged pending again so the
// bucket's lifecycle rule deletes them within a day. Rekognition reads the files with this
// server's own AWS permissions (s3:GetObject on the media bucket).

export interface MediaReview {
  key: string;
  memberId: string;
  kind: PostMediaKind;
  status: ReviewStatus;
  reasons: ReviewReason[];
  jobId: string | null;
  checkedAt: number;
}

export interface ReviewTarget {
  key: string;
  memberId: string;
  kind: PostMediaKind;
  contentType: string;
}

/** A running video check is asked for its result at most this often. */
const REFRESH_MS = 10_000;
/** Per feed request: pending video checks to collect, and files with no check yet to start. */
const MAX_REFRESH = 3;
const MAX_LAZY = 2;
/** Rekognition errors that mean this particular file can't be read, not that the service is down. */
const UNREADABLE = new Set(["InvalidImageFormatException", "ImageTooLargeException", "InvalidParameterException", "VideoTooLargeException"]);

const cache = globalThis as typeof globalThis & { __docketRekognition?: RekognitionClient };
const rekognition = () => (cache.__docketRekognition ??= new RekognitionClient({ region: process.env.DOCKET_MEDIA_REGION ?? process.env.AWS_REGION ?? "us-west-2" }));

function bucket(): string {
  const name = mediaBucket();
  if (!name) throw new Error("DOCKET_MEDIA_BUCKET is not set.");
  return name;
}

interface Row {
  object_key: string;
  member_id: string;
  kind: PostMediaKind;
  status: ReviewStatus;
  reasons: ReviewReason[] | null;
  job_id: string | null;
  checked_at: Date;
}

const SELECT = "SELECT object_key, member_id, kind, status, reasons, job_id, checked_at FROM media_reviews";

const toReview = (r: Row): MediaReview => ({
  key: r.object_key,
  memberId: r.member_id,
  kind: r.kind,
  status: r.status,
  reasons: Array.isArray(r.reasons) ? r.reasons : [],
  jobId: r.job_id,
  checkedAt: new Date(r.checked_at).getTime(),
});

async function getReview(key: string): Promise<MediaReview | null> {
  const { rows } = await db().query<Row>(`${SELECT} WHERE object_key = $1`, [key]);
  return rows[0] ? toReview(rows[0]) : null;
}

async function save(review: Omit<MediaReview, "checkedAt">): Promise<MediaReview> {
  await db().query(
    `INSERT INTO media_reviews (object_key, member_id, kind, status, reasons, job_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (object_key) DO UPDATE SET status = EXCLUDED.status, reasons = EXCLUDED.reasons, job_id = EXCLUDED.job_id, checked_at = now()`,
    [review.key, review.memberId, review.kind, review.status, JSON.stringify(review.reasons), review.jobId],
  );
  return { ...review, checkedAt: Date.now() };
}

const errorName = (error: unknown) => (error as { name?: string } | null)?.name ?? "";

async function reviewImage(base: Omit<MediaReview, "status" | "reasons" | "checkedAt">): Promise<MediaReview> {
  const image = { S3Object: { Bucket: bucket(), Name: base.key } };
  try {
    const [labels, text] = await Promise.all([
      rekognition().send(new DetectModerationLabelsCommand({ Image: image, MinConfidence: 50 })),
      rekognition().send(new DetectTextCommand({ Image: image })),
    ]);
    const lines = (text.TextDetections ?? []).filter((d) => d.Type === "LINE").map((d) => d.DetectedText ?? "");
    const reasons = [...new Set([...judgeLabels(labels.ModerationLabels ?? []), ...judgeText(lines)])];
    return await save({ ...base, status: reasons.length ? "blocked" : "approved", reasons });
  } catch (error) {
    if (UNREADABLE.has(errorName(error))) return save({ ...base, status: "failed", reasons: ["unreadable"] });
    throw error;
  }
}

async function startVideo(base: Omit<MediaReview, "status" | "reasons" | "checkedAt">): Promise<MediaReview> {
  // The token makes a retried start return the same job instead of paying for a second one.
  const day = Math.floor(Date.now() / 86_400_000);
  const token = `${createHash("sha256").update(base.key).digest("hex").slice(0, 48)}-${day}`;
  try {
    const job = await rekognition().send(
      new StartContentModerationCommand({
        Video: { S3Object: { Bucket: bucket(), Name: base.key } },
        MinConfidence: 50,
        ClientRequestToken: token,
        JobTag: "docket-post-media",
      }),
    );
    return await save({ ...base, status: "pending", reasons: [], jobId: job.JobId ?? null });
  } catch (error) {
    if (UNREADABLE.has(errorName(error))) return save({ ...base, status: "failed", reasons: ["unreadable"], jobId: null });
    throw error;
  }
}

/** Collects a video check's result, or leaves it pending while Rekognition is still working. */
async function refreshVideo(review: MediaReview): Promise<MediaReview> {
  if (review.kind !== "video" || review.status !== "pending") return review;
  if (Date.now() - review.checkedAt < REFRESH_MS) return review;
  if (!review.jobId) return startVideo(review);
  const labels: ModerationLabel[] = [];
  let nextToken: string | undefined;
  try {
    for (let page = 0; page < 20; page++) {
      const result = await rekognition().send(new GetContentModerationCommand({ JobId: review.jobId, MaxResults: 1000, NextToken: nextToken }));
      if (result.JobStatus === "IN_PROGRESS") {
        await db().query("UPDATE media_reviews SET checked_at = now() WHERE object_key = $1", [review.key]);
        return { ...review, checkedAt: Date.now() };
      }
      if (result.JobStatus === "FAILED") {
        console.warn(`[docket] video check failed for ${review.key}: ${result.StatusMessage ?? "unknown"}`);
        return save({ ...review, status: "failed", reasons: ["unreadable"] });
      }
      for (const item of result.ModerationLabels ?? []) if (item.ModerationLabel) labels.push(item.ModerationLabel);
      nextToken = result.NextToken;
      if (!nextToken) break;
    }
  } catch (error) {
    // Rekognition keeps results for 7 days; start over if the job is gone.
    if (errorName(error) === "ResourceNotFoundException") return startVideo(review);
    throw error;
  }
  const reasons = judgeLabels(labels);
  const done = await save({ ...review, status: reasons.length ? "blocked" : "approved", reasons });
  if (reasons.length) await setUploadState(review.key, "pending").catch((error) => console.error("[docket] couldn't mark a blocked video for deletion", error));
  return done;
}

/**
 * Checks one upload, or returns its earlier result. Null when the file isn't in the bucket or belongs
 * to someone else. Throws when Rekognition or S3 can't be reached, so nothing is marked on a outage.
 */
export async function reviewUpload(target: ReviewTarget): Promise<MediaReview | null> {
  const existing = await getReview(target.key);
  if (existing) {
    if (existing.memberId !== target.memberId) return null;
    return refreshVideo(existing);
  }
  const start = await readFileStart(target.key);
  if (!start) return null;
  const base = { key: target.key, memberId: target.memberId, kind: target.kind, jobId: null };
  if (!sniffMatches(target.contentType, start)) return save({ ...base, status: "blocked", reasons: ["not_media"] });
  return target.kind === "image" ? reviewImage(base) : startVideo(base);
}

/**
 * Check results for the files on a page of posts. Also collects finished video checks and starts
 * checks for files that never had one, a few per request; failures there leave files pending.
 */
export async function reviewsFor(targets: ReviewTarget[]): Promise<Map<string, MediaReview>> {
  const reviews = new Map<string, MediaReview>();
  if (!targets.length) return reviews;
  const { rows } = await db().query<Row>(`${SELECT} WHERE object_key IN (SELECT jsonb_array_elements_text($1::jsonb))`, [
    JSON.stringify([...new Set(targets.map((t) => t.key))]),
  ]);
  for (const row of rows) reviews.set(row.object_key, toReview(row));
  if (!mediaBucket()) return reviews;

  const now = Date.now();
  const stale = [...reviews.values()].filter((r) => r.status === "pending" && now - r.checkedAt >= REFRESH_MS).slice(0, MAX_REFRESH);
  const unchecked = targets.filter((t, i) => !reviews.has(t.key) && targets.findIndex((o) => o.key === t.key) === i).slice(0, MAX_LAZY);
  await Promise.all([
    ...stale.map((r) =>
      refreshVideo(r)
        .then((next) => reviews.set(next.key, next))
        .catch((error) => console.error("[docket] couldn't collect a video check", error)),
    ),
    ...unchecked.map((t) =>
      reviewUpload(t)
        .then((next) => (next ? reviews.set(next.key, next) : null))
        .catch((error) => console.error("[docket] couldn't check a post's media", error)),
    ),
  ]);
  return reviews;
}
