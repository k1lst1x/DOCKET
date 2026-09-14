import { NextResponse } from "next/server";
import { parseLogin } from "@/lib/account-fields";
import { isSameOrigin, setSessionCookie } from "@/lib/auth";
import { authFailure, noStore } from "@/lib/auth-http";
import { loginMember } from "@/lib/members";
import { allowLoginRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Signs in with an email and password. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403, headers: noStore });
  if (!allowLoginRequest(request)) return authFailure("busy");

  const parsed = parseLogin(await request.json().catch(() => null));
  if (!parsed.ok) return authFailure("invalid", parsed.errors);

  try {
    const result = await loginMember(parsed.value.email, parsed.value.password, null);
    if (!result.ok) return authFailure("wrong_password");
    const response = NextResponse.json({ ok: true, name: result.session.name }, { headers: noStore });
    setSessionCookie(response, result.session);
    return response;
  } catch (error) {
    console.error("[docket] login: could not check the account", error);
    return authFailure("unavailable");
  }
}
