import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinFlow } from "@/components/JoinFlow";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getGroup } from "@/lib/data";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const group = getGroup((await params).slug);
  return { title: group ? `Join ${group.name}` : "Group not found", robots: { index: false } };
}

export default async function JoinPage({ params }: { params: Params }) {
  const group = getGroup((await params).slug);
  if (!group) notFound();

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
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
