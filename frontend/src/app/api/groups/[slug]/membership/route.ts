import { NextResponse } from "next/server";
import { getSession, isSameOrigin, setSessionCookie } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";
import { getGroup } from "@/lib/data";
import { parsePreferences } from "@/lib/join";
import { joinGroup, listMemberships } from "@/lib/members";
import { allowJoinRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** One-step join for members who are already signed in. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  if (!allowJoinRequest(request)) {
    return NextResponse.json({ error: "Too many join requests. Try again shortly." }, { status: 429, headers: noStore });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not_signed_in" }, { status: 401, headers: noStore });

  const group = getGroup((await params).slug);
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = parsePreferences(body, group.watchlist);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Check the highlighted fields.", fields: parsed.errors }, { status: 400 });
  }

  try {
    await joinGroup(session.memberId, { slug: group.slug, ...parsed.value });
    const groups = await listMemberships(session.memberId);
    const response = NextResponse.json(
      { ok: true, name: session.name, group: { slug: group.slug, name: group.name, district: group.district, items: group.items } },
      { status: 201, headers: noStore },
    );
    setSessionCookie(response, { ...session, groups });
    return response;
  } catch (error) {
    console.error("[docket] membership join failed", error);
    return NextResponse.json({ error: "Joining is unavailable right now. Try again shortly." }, { status: 503, headers: noStore });
  }
}
