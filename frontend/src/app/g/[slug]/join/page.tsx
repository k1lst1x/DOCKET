import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { JoinFlow } from "@/components/JoinFlow";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getSession } from "@/lib/auth";
import { getGroup } from "@/lib/data";
import { listMemberships } from "@/lib/members";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const group = getGroup((await params).slug);
  return { title: group ? `Join ${group.name}` : "Group not found", robots: { index: false } };
}

export default async function JoinPage({ params }: { params: Params }) {
  const group = getGroup((await params).slug);
  if (!group) notFound();

  const session = await getSession();
  if (session) {
    let groups = session.groups;
    try {
      groups = await listMemberships(session.memberId);
    } catch {
      // Database unavailable: fall back to the groups remembered in the session.
    }
    // Already a member: nothing to join again.
    if (groups.some((g) => g.slug === group.slug)) redirect(`/g/${group.slug}`);
  }

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <div className="page py-8 sm:py-14">
          <JoinFlow
            group={{
              slug: group.slug,
              name: group.name,
              district: group.district,
              memberCount: group.memberCount,
              watchlist: group.watchlist,
            }}
            member={session ? { name: session.name, email: session.email } : null}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
