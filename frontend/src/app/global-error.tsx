"use client";

import { useEffect } from "react";
import { ErrorScene } from "@/components/pixel/ErrorScene";
import "./globals.css";

// Last resort when the root layout itself fails: it replaces the whole document, so it stays
// free of the header, fonts and chat widget that may be what broke.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-sky-mist">
        <title>Something went wrong · Docket</title>
        <main id="main" className="page grid min-h-screen place-items-center py-10">
          <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-rule bg-gradient-to-b from-sky-top/70 via-sky to-sky-haze">
            <div className="px-6 pt-8 sm:px-10 sm:pt-12">
              <p className="font-mono text-sm font-medium text-ink">500 · Something broke</p>
              <h1 className="display mt-3 text-[2rem] leading-[1.1] sm:text-[2.5rem]">Docket couldn&apos;t load.</h1>
              <p className="mt-3 text-lg leading-relaxed text-ink-soft">
                Something went wrong on our side. Try again in a moment.
              </p>
              {error.digest ? <p className="mt-3 font-mono text-sm text-ink-muted">Reference: {error.digest}</p> : null}
              <div className="mt-7 flex flex-wrap gap-3">
                <button type="button" onClick={reset} className="btn btn-primary rounded-full">
                  Try again
                </button>
                {/* A full page load, since client navigation may be what failed. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/" className="btn btn-secondary rounded-full">
                  Go to the home page
                </a>
              </div>
            </div>
            <ErrorScene code="500" mood="broken" className="h-auto w-full" />
          </section>
        </main>
      </body>
    </html>
  );
}
