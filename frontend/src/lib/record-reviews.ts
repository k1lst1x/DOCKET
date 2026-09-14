import { db } from "./db";
import { moderateText } from "./moderation";
import { shortName } from "./posts-shared";
import { RECORD_SOURCES, UUID } from "./record-detail";

// Reviews on neighborhood records (record_reviews): text only, one per neighbor per record, no vote first.
// Stored text is checked again when read, so a review that a later filter update blocks disappears for
// everyone but its author.

export const REVIEW_MIN = 10;
export const REVIEW_MAX = 2000;

export interface RecordReview {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  edited: boolean;
  mine: boolean;
  sample: boolean;
}

export interface RecordReviews {
  items: RecordReview[];
  mine: { body: string } | null;
}

export type RecordReviewErrorCode = "invalid_review" | "review_blocked" | "not_found";

export class RecordReviewError extends Error {
  constructor(readonly code: RecordReviewErrorCode) {
    super(code);
  }
}

interface ReviewRow {
  id: string;
  body: string;
  created_at: Date | string;
  updated_at: Date | string;
  member_id: string;
  name: string;
  is_sample: boolean;
}

const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;

/** Reviews as shown to one viewer (memberId null when signed out). */
export function toRecordReviews(rows: ReviewRow[], memberId: string | null): RecordReviews {
  const items: RecordReview[] = [];
  let mine: RecordReviews["mine"] = null;
  for (const row of rows) {
    const isMine = memberId !== null && row.member_id === memberId;
    if (isMine) mine = { body: row.body };
    if (!isMine && !moderateText(row.body).ok) continue;
    const created = new Date(row.created_at);
    items.push({
      id: row.id,
      author: moderateText(row.name).ok ? shortName(row.name) : "Neighbor",
      body: row.body,
      createdAt: created.toISOString(),
      edited: new Date(row.updated_at).getTime() - created.getTime() > 60_000,
      mine: isMine,
      sample: row.is_sample,
    });
  }
  return { items, mine };
}

export async function listRecordReviews(recordId: string, memberId: string | null): Promise<RecordReviews> {
  if (!UUID.test(recordId)) return { items: [], mine: null };
  try {
    const { rows } = await db().query<ReviewRow>(
      `SELECT r.id, r.body, r.created_at, r.updated_at, r.member_id, m.name, m.is_sample
         FROM record_reviews r JOIN members m ON m.id = r.member_id
        WHERE r.record_id = $1
        ORDER BY r.created_at DESC
        LIMIT 60`,
      [recordId],
    );
    return toRecordReviews(rows, memberId);
  } catch (error) {
    // Before migration 0007 runs there's nothing to list.
    if (errorCode(error) === "42P01") return { items: [], mine: null };
    throw error;
  }
}

/** Checks a review's text; throws RecordReviewError when it can't be saved. */
export function checkReviewBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length < REVIEW_MIN || body.length > REVIEW_MAX) throw new RecordReviewError("invalid_review");
  if (!moderateText(body).ok) throw new RecordReviewError("review_blocked");
  return body;
}

/** Saves the neighbor's review of a record, replacing their earlier one. */
export async function saveRecordReview(memberId: string, recordId: string, raw: unknown): Promise<void> {
  const body = checkReviewBody(raw);
  if (!UUID.test(recordId)) throw new RecordReviewError("not_found");
  const sources = Object.keys(RECORD_SOURCES);
  const { rows } = await db().query<{ id: string }>(
    `SELECT id FROM agent_documents WHERE id = $1 AND source_id IN (${sources.map((_, i) => `$${i + 2}`).join(", ")})`,
    [recordId, ...sources],
  );
  if (!rows.length) throw new RecordReviewError("not_found");
  await db().query(
    `INSERT INTO record_reviews (record_id, member_id, body) VALUES ($1, $2, $3)
     ON CONFLICT (record_id, member_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
    [recordId, memberId, body],
  );
}

export async function deleteRecordReview(memberId: string, recordId: string): Promise<void> {
  if (!UUID.test(recordId)) throw new RecordReviewError("not_found");
  await db().query("DELETE FROM record_reviews WHERE record_id = $1 AND member_id = $2", [recordId, memberId]);
}
