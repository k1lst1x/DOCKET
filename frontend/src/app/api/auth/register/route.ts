import { NextResponse } from "next/server";
import { parseRegistration } from "@/lib/account-fields";
import { isSameOrigin, setSessionCookie } from "@/lib/auth";
import { authFailure, noStore } from "@/lib/auth-http";
import { registerMember } from "@/lib/members";
import { allowRegisterRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Creates an account from a name, email and password and signs it in right away. No email is sent. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403, headers: noStore });
  if (!allowRegisterRequest(request)) return authFailure("busy");

  const parsed = parseRegistration(await request.json().catch(() => null));
  if (!parsed.ok) return authFailure("invalid", parsed.errors);
  const { name, email, password } = parsed.value;

  try {
    const result = await registerMember(name, email, password, null);
    if (!result.ok) return authFailure("email_taken", { email: "An account already uses this email. Log in instead." });
    const response = NextResponse.json({ ok: true, name: result.session.name }, { status: 201, headers: noStore });
    setSessionCookie(response, result.session);
    return response;
  } catch (error) {
    console.error("[docket] register: could not save the account", error);
    return authFailure("unavailable");
  }
}
