import { NextResponse } from "next/server";
import type { PostErrorCode } from "./posts-types";

export const noStore = { "Cache-Control": "no-store" };

const STATUS: Record<PostErrorCode, number> = {
  not_signed_in: 401,
  invalid_post: 400,
  post_blocked: 422,
  link_blocked: 422,
  media_invalid: 400,
  media_blocked: 422,
  media_unreviewable: 422,
  media_unavailable: 503,
  not_found: 404,
  forbidden: 403,
  busy: 429,
  unavailable: 503,
};

export function postFailure(code: PostErrorCode): NextResponse {
  return NextResponse.json({ error: code }, { status: STATUS[code], headers: noStore });
}
