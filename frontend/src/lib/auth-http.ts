import { NextResponse } from "next/server";
import type { AuthErrorCode } from "./auth-codes";

const STATUS: Record<AuthErrorCode, number> = {
  wrong_code: 400,
  expired: 410,
  signin_required: 409,
  undeliverable: 422,
  not_invited: 403,
  busy: 429,
  not_configured: 503,
  unavailable: 503,
  failed: 502,
};

export const noStore = { "Cache-Control": "no-store" };

export function authFailure(code: AuthErrorCode): NextResponse {
  return NextResponse.json({ error: code }, { status: STATUS[code], headers: noStore });
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
