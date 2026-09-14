"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { ErrorView } from "@/components/ErrorView";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

// Catches errors thrown while rendering any page below the root layout.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
    // Client error boundaries can't export metadata.
    document.title = "Something went wrong · Docket";
  }, [error]);

  function retry() {
    // Server components need a refresh as well as a reset to render again.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <>
      <SiteHeader />
      <ErrorView
        code="500"
        label="Something broke"
        mood="broken"
        headline="Something went wrong on our side."
        body={
          <>
            <p>It&apos;s not you. Docket hit a snag loading this page. Try again in a moment, or head back to the feed.</p>
            {error.digest ? <p className="mt-3 font-mono text-sm text-ink-muted">Reference: {error.digest}</p> : null}
          </>
        }
        actions={
          <>
            <button type="button" onClick={retry} className="btn btn-primary rounded-full">
              Try again
            </button>
            <Link href="/" className="btn btn-secondary rounded-full">
              Back to the feed
            </Link>
          </>
        }
      />
      <SiteFooter />
    </>
  );
}
