import { NextResponse } from "next/server";
import type { AuthErrorCode } from "./auth-codes";

const STATUS: Record<AuthErrorCode, number> = {
  invalid: 400,
  wrong_password: 401,
  email_taken: 409,
  busy: 429,
  unavailable: 503,
  failed: 502,
};

export const noStore = { "Cache-Control": "no-store" };

export function authFailure(code: AuthErrorCode, fields?: Partial<Record<string, string>>): NextResponse {
  return NextResponse.json(fields ? { error: code, fields } : { error: code }, { status: STATUS[code], headers: noStore });
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
