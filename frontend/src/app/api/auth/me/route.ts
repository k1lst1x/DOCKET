import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json(
    session ? { signedIn: true, name: session.name, groups: session.groups } : { signedIn: false },
    { headers: noStore },
  );
}
