import { NextResponse } from "next/server";
import { isSameOrigin, safeNextPath, setPendingCookie } from "@/lib/auth";
import { authFailure, EMAIL_PATTERN, noStore } from "@/lib/auth-http";
import { AuthError, sendCode } from "@/lib/cognito";
import { allowCodeRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Sign-in page: email a one-time code to an existing member. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403 });
  if (!allowCodeRequest(request)) return authFailure("busy");

  const body = (await request.json().catch(() => null)) as { email?: unknown; next?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400, headers: noStore });
  }

  try {
    const challenge = await sendCode(email, null);
    // Same response whether or not the address has an account (the Cognito app
    // client hides user existence), so this can't be used to probe members.
    const response = NextResponse.json({ status: "sent" }, { status: 202, headers: noStore });
    setPendingCookie(response, {
      kind: challenge.kind,
      email,
      name: null,
      cognitoSession: challenge.cognitoSession,
      join: null,
      next: safeNextPath(body?.next, "/"),
    });
    return response;
  } catch (error) {
    const code = error instanceof AuthError ? error.code : "failed";
    if (code === "failed") console.error("[docket] sign-in: could not send code", error);
    return authFailure(code);
  }
}
