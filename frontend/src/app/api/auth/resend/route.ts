import { NextResponse } from "next/server";
import { isSameOrigin, readPending, setPendingCookie } from "@/lib/auth";
import { authFailure, noStore } from "@/lib/auth-http";
import { AuthError, resendCode } from "@/lib/cognito";
import { allowCodeRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403 });
  if (!allowCodeRequest(request)) return authFailure("busy");

  const pending = await readPending();
  if (!pending) return authFailure("expired");

  try {
    const challenge = await resendCode(pending);
    const response = NextResponse.json({ status: "sent" }, { status: 202, headers: noStore });
    setPendingCookie(response, { ...pending, kind: challenge.kind, cognitoSession: challenge.cognitoSession });
    return response;
  } catch (error) {
    return authFailure(error instanceof AuthError ? error.code : "failed");
  }
}
