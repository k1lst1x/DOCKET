import { NextResponse } from "next/server";
import { createMagicLink, deliverMagicLink, isSameOrigin, safeNextPath } from "@/lib/auth";
import { findMemberByEmail } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown; next?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "Enter your email." }, { status: 400 });

  const member = findMemberByEmail(email);
  if (member) {
    const home = member.memberships[0] ? `/g/${member.memberships[0].slug}` : "/";
    deliverMagicLink(member.email, createMagicLink(member.id, safeNextPath(body?.next, home)));
  }

  // Identical response either way: this endpoint must not reveal who is a member.
  return NextResponse.json({ status: "sent" }, { status: 202 });
}
