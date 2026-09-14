import { GetObjectCommand, HeadObjectCommand, PutObjectTaggingCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { maxBytes, mediaKey, type PostMediaKind, type StoredMedia } from "./post-media";

// The private S3 bucket for photos and videos in posts (DOCKET_MEDIA_BUCKET).
// Browsers upload straight to it with a short-lived signed POST; the feed shows files through
// signed GET links. Uploads are tagged "pending" and a bucket lifecycle rule deletes pending
// files after a day, so files that never make it into a post don't pile up. Locally it uses the
// credentials in .env.local; on Amplify, the SSR compute role.

const UPLOAD_TICKET_SECONDS = 10 * 60;
const VIEW_LINK_SECONDS = 12 * 60 * 60;
const STATE_TAG = "docket-state";
const tagging = (state: "pending" | "posted") => `<Tagging><TagSet><Tag><Key>${STATE_TAG}</Key><Value>${state}</Value></Tag></TagSet></Tagging>`;

const cache = globalThis as typeof globalThis & { __docketS3?: S3Client };

export function mediaBucket(): string | null {
  return process.env.DOCKET_MEDIA_BUCKET?.trim() || null;
}

function s3(): S3Client {
  return (cache.__docketS3 ??= new S3Client({ region: process.env.DOCKET_MEDIA_REGION ?? process.env.AWS_REGION ?? "us-west-2" }));
}

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/** A signed form the browser posts the file to. S3 rejects other types or a larger file. */
export async function createUploadTicket(memberId: string, input: { kind: PostMediaKind; contentType: string }): Promise<UploadTicket> {
  const bucket = mediaBucket();
  if (!bucket) throw new Error("DOCKET_MEDIA_BUCKET is not set.");
  const key = mediaKey(memberId, crypto.randomUUID(), input.contentType);
  const { url, fields } = await createPresignedPost(s3(), {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ["content-length-range", 1, maxBytes(input.kind)],
      ["eq", "$Content-Type", input.contentType],
      ["eq", "$tagging", tagging("pending")],
    ],
    Fields: { "Content-Type": input.contentType, tagging: tagging("pending") },
    Expires: UPLOAD_TICKET_SECONDS,
  });
  return { url, fields, key };
}

/**
 * Confirms each upload reached the bucket with the declared type and an allowed size, then marks
 * it posted so the cleanup rule keeps it. Returns null when any file is missing or doesn't match.
 */
export async function confirmUploads(media: Omit<StoredMedia, "size">[]): Promise<StoredMedia[] | null> {
  const bucket = mediaBucket();
  if (!bucket) throw new Error("DOCKET_MEDIA_BUCKET is not set.");
  const heads = await Promise.all(
    media.map((m) =>
      s3()
        .send(new HeadObjectCommand({ Bucket: bucket, Key: m.key }))
        .catch((error: { name?: string; $metadata?: { httpStatusCode?: number } }) => {
          if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return null;
          throw error;
        }),
    ),
  );
  const confirmed: StoredMedia[] = [];
  for (const [i, head] of heads.entries()) {
    const size = head?.ContentLength ?? 0;
    if (!head || head.ContentType !== media[i].contentType || size < 1 || size > maxBytes(media[i].kind)) return null;
    confirmed.push({ ...media[i], size });
  }
  await Promise.all(
    media.map((m) =>
      s3().send(
        new PutObjectTaggingCommand({ Bucket: bucket, Key: m.key, Tagging: { TagSet: [{ Key: STATE_TAG, Value: "posted" }] } }),
      ),
    ),
  );
  return confirmed;
}

/** The first bytes of an upload, for checking what kind of file it really is. Null when it isn't there. */
export async function readFileStart(key: string, bytes = 32): Promise<Uint8Array | null> {
  const bucket = mediaBucket();
  if (!bucket) throw new Error("DOCKET_MEDIA_BUCKET is not set.");
  try {
    const object = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return object.Body ? await object.Body.transformToByteArray() : null;
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** Marks an upload posted (kept) or pending (the bucket's lifecycle rule deletes it within a day). */
export async function setUploadState(key: string, state: "pending" | "posted"): Promise<void> {
  const bucket = mediaBucket();
  if (!bucket) throw new Error("DOCKET_MEDIA_BUCKET is not set.");
  await s3().send(new PutObjectTaggingCommand({ Bucket: bucket, Key: key, Tagging: { TagSet: [{ Key: STATE_TAG, Value: state }] } }));
}

/** A temporary link for showing an upload in the feed. */
export async function viewUrl(key: string): Promise<string | null> {
  const bucket = mediaBucket();
  if (!bucket) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: VIEW_LINK_SECONDS });
}
