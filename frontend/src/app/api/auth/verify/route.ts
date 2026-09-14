import { NextResponse } from "next/server";
import { clearPendingCookie, isSameOrigin, readPending, setPendingCookie, setSessionCookie, type Session } from "@/lib/auth";
import { authFailure, noStore } from "@/lib/auth-http";
import { AuthError, sendCode, verifyCode, type VerifiedIdentity } from "@/lib/cognito";
import { recordSignIn } from "@/lib/members";
import { allowVerifyRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Confirms the emailed code, saves the member to DSQL, and signs them in. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403 });
  if (!allowVerifyRequest(request)) return authFailure("busy");

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!/^\d{6,8}$/.test(code)) return authFailure("wrong_code");

  const pending = await readPending();
  if (!pending) return authFailure("expired");

  let identity: VerifiedIdentity;
  try {
    identity = await verifyCode(pending, code);
  } catch (error) {
    const reason = error instanceof AuthError ? error.code : "failed";
    if (reason !== "signin_required") {
      if (reason === "failed") console.error("[docket] verify: code check failed", error);
      return authFailure(reason);
    }
    // Email confirmed, but Cognito needs a separate sign-in code to finish.
    try {
      const challenge = await sendCode(pending.email, null);
      const response = authFailure("signin_required");
      setPendingCookie(response, { ...pending, kind: challenge.kind, cognitoSession: challenge.cognitoSession });
      return response;
    } catch (sendError) {
      return authFailure(sendError instanceof AuthError ? sendError.code : "failed");
    }
  }

  let session: Session;
  try {
    session = await recordSignIn(identity, pending.name, pending.join);
  } catch (error) {
    // Cognito already accepted the code (and used up its session), so this is a server problem, not a wrong code.
    const hint = /Could not load credentials|CredentialsProviderError/.test(String(error))
      ? " (the server has no AWS credentials: on Amplify, attach the docket-amplify-compute role from scripts/aws-amplify-role.sh and redeploy)"
      : "";
    console.error(`[docket] verify: could not save member${hint}`, error);
    return authFailure("unavailable");
  }

  const response = NextResponse.json({ ok: true, name: session.name, next: pending.next }, { headers: noStore });
  setSessionCookie(response, session);
  clearPendingCookie(response);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
