import { NextResponse } from "next/server";
import { isSameOrigin, setPendingCookie } from "@/lib/auth";
import type { CodeStatus } from "@/lib/auth-codes";
import { noStore } from "@/lib/auth-http";
import { AuthError, sendCode, type CodeChallenge } from "@/lib/cognito";
import { getGroup } from "@/lib/data";
import { parseJoin } from "@/lib/join";
import { allowJoinRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  }
  if (!allowJoinRequest(request)) {
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
    return NextResponse.json({ error: "Check the highlighted fields.", fields: parsed.errors }, { status: 400 });
  }
  const email = parsed.value.email.toLowerCase();

  // Creates the Cognito account (or starts a sign-in for an existing one) and
  // emails a code. The membership is saved once the code is confirmed.
  let challenge: CodeChallenge | null = null;
  let code: CodeStatus = "sent";
  try {
    challenge = await sendCode(email, parsed.value.name);
  } catch (error) {
    code = error instanceof AuthError ? error.code : "failed";
    if (code === "failed") console.error("[docket] join: could not send code", error);
  }

  // The group's items are returned either way: nobody has to verify an email
  // before they can see what the group is watching.
  const response = NextResponse.json(
    { email, code, group: { slug: group.slug, name: group.name, district: group.district, items: group.items } },
    { status: 201, headers: noStore },
  );
  if (challenge) {
    setPendingCookie(response, {
      kind: challenge.kind,
      email,
      name: parsed.value.name,
      cognitoSession: challenge.cognitoSession,
      join: {
        slug: group.slug,
        topics: parsed.value.topics,
        otherTopic: parsed.value.otherTopic,
        canSpeakEvenings: parsed.value.canSpeakEvenings,
      },
      next: `/g/${group.slug}`,
    });
  }
  return response;
}
