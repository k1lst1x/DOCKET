import { NextResponse } from "next/server";
import { getSession, setSessionCookie } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";
import { listMemberships } from "@/lib/members";

export const dynamic = "force-dynamic";

/**
 * Who is signed in. Every call re-issues the session cookie, so the 30-day
 * sign-in keeps sliding forward while someone keeps using Docket, and refreshes
 * the group list from the database.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ signedIn: false }, { headers: noStore });

  let groups = session.groups;
  try {
    groups = await listMemberships(session.memberId);
  } catch {
    // Database unavailable: keep the groups remembered in the cookie.
  }

  const response = NextResponse.json({ signedIn: true, name: session.name, groups }, { headers: noStore });
  setSessionCookie(response, { ...session, groups });
  return response;
}
