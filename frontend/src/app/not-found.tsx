import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-white">
        <div className="page py-10 sm:py-14">
          <EmptyState
            headingLevel="h1"
            headline="That page isn't on the docket."
            body="The link may be old, or the group may have changed its address. The directory lists every group."
            actions={
              <>
                <Link href="/groups" className="btn btn-primary">
                  See all groups
                </Link>
                <Link href="/" className="btn btn-secondary">
                  Look up my address
                </Link>
              </>
            }
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
