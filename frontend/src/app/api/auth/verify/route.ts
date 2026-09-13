import { NextResponse, type NextRequest } from "next/server";
import { readMagicToken, setSessionCookie } from "@/lib/auth";
import { getMember, markVerified, spendMagicNonce } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = process.env.APP_URL ?? request.nextUrl.origin;
  const payload = readMagicToken(request.nextUrl.searchParams.get("token") ?? "");
  const member = payload ? getMember(payload.memberId) : undefined;

  if (!payload || !member || !spendMagicNonce(payload.nonce, payload.exp * 1000)) {
    return NextResponse.redirect(new URL("/?signin=expired", origin), 303);
  }

  markVerified(member);
  const response = NextResponse.redirect(new URL(payload.next, origin), 303);
  // Roles come from the member record at sign-in time, not from the link.
  setSessionCookie(response, {
    memberId: member.id,
    groups: member.memberships.map((m) => ({ groupId: m.groupId, slug: m.slug, role: m.role })),
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
