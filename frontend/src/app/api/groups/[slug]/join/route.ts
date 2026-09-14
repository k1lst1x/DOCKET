import { NextResponse } from "next/server";
import { isSameOrigin, setSessionCookie } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";
import { getGroup } from "@/lib/data";
import { parseJoin } from "@/lib/join";
import { loginMember, registerMember, type AccountResult } from "@/lib/members";
import { allowJoinRequest, allowLoginRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Join form for someone who isn't signed in: creates the account (or logs in to an existing one with its password),
 * saves the membership and signs them in, all in one step.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  }
  if (!allowJoinRequest(request) || !allowLoginRequest(request)) {
    return NextResponse.json({ error: "Too many join requests. Try again shortly." }, { status: 429, headers: noStore });
  }

  // The group comes from the URL, never from the request body.
  const group = getGroup((await params).slug);
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the form as JSON." }, { status: 400 });
  }

  const parsed = parseJoin(body, group.watchlist);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Check the highlighted fields.", fields: parsed.errors }, { status: 400, headers: noStore });
  }
  const { name, email, password, topics, otherTopic, canSpeakEvenings } = parsed.value;
  const join = { slug: group.slug, topics, otherTopic, canSpeakEvenings };

  let result: AccountResult;
  try {
    result = await registerMember(name, email, password, join);
    // Someone who already has an account can join with its password instead of logging in first.
    if (!result.ok) result = await loginMember(email, password, join);
  } catch (error) {
    console.error("[docket] join: could not save the account", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "email_taken",
        fields: { password: "An account already uses this email, and that isn't its password. Enter the right password, or log in first." },
      },
      { status: 409, headers: noStore },
    );
  }

  const response = NextResponse.json(
    {
      name: result.session.name,
      created: result.created,
      group: { slug: group.slug, name: group.name, district: group.district, items: group.items },
    },
    { status: 201, headers: noStore },
  );
  setSessionCookie(response, result.session);
  return response;
}
