import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Start a group", robots: { index: false } };

export default async function StartPage({ searchParams }: { searchParams: Promise<{ address?: string | string[] }> }) {
  const { address } = await searchParams;
  const place = (Array.isArray(address) ? address[0] : address)?.slice(0, 200);

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-white">
        <div className="page py-10 sm:py-14">
          <EmptyState
            headingLevel="h1"
            headline="Start a group for your block"
            body={
              <>
                <p>
                  The Clerk, Docket&apos;s setup guide, walks you through naming the group, drawing its boundary
                  {place ? (
                    <>
                      {" "}
                      around <span className="font-semibold text-ink">{place}</span>
                    </>
                  ) : null}
                  , and choosing what to watch at city hall.
                </p>
                <p className="mt-3">
                  The Clerk opens soon. Until then, a nearby group is the quickest way to hear what&apos;s coming up.
                </p>
              </>
            }
            actions={
              <Link href="/groups" className="btn btn-primary">
                Browse groups
              </Link>
            }
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
