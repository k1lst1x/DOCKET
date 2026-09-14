import type { Metadata } from "next";
import Link from "next/link";
import { ErrorView } from "@/components/ErrorView";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <ErrorView
        code="404"
        label="Page not found"
        mood="lost"
        headline="That page isn't on the docket."
        body="The link may be old, or the group may have changed its address. Even the birds looked everywhere. The directory lists every group."
        actions={
          <>
            <Link href="/groups" className="btn btn-primary rounded-full">
              See all groups
            </Link>
            <Link href="/app" className="btn btn-secondary rounded-full">
              Back to the feed
            </Link>
          </>
        }
      />
      <SiteFooter />
    </>
  );
}
