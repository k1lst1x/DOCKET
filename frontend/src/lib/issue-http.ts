import { NextResponse } from "next/server";
import type { IssueActionErrorCode } from "./issue-types";

const STATUS: Record<IssueActionErrorCode, number> = {
  not_signed_in: 401,
  not_found: 404,
  not_member: 403,
  invalid_choice: 400,
  closed: 409,
  vote_first: 403,
  invalid_review: 400,
  busy: 429,
  unavailable: 503,
};

export function issueFailure(code: IssueActionErrorCode): NextResponse {
  return NextResponse.json({ error: code }, { status: STATUS[code], headers: { "Cache-Control": "no-store" } });
}

export const ISSUE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
