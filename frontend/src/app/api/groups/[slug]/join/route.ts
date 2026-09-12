import { NextResponse } from "next/server";
import { createMagicLink, deliverMagicLink, isSameOrigin } from "@/lib/auth";
import { getGroup } from "@/lib/data";
import { parseJoin } from "@/lib/join";
import { upsertMembership } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
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

  const { member } = upsertMembership({ ...parsed.value, groupId: group.id, slug: group.slug });
  deliverMagicLink(member.email, createMagicLink(member.id, `/g/${group.slug}`));

  // Same response whether or not the email was already a member, so the form
  // can't be used to discover who belongs to a group.
  return NextResponse.json(
    {
      email: parsed.value.email,
      verification: "sent",
      devLinkInConsole: process.env.NODE_ENV !== "production",
      group: { slug: group.slug, name: group.name, district: group.district, items: group.items },
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
