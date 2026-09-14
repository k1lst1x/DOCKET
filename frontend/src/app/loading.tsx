import { SiteHeader } from "@/components/SiteHeader";

// Shown the moment a link opens a page that is still being prepared on the server, so a tap never looks
// like it did nothing. Pages that are already built open straight away and skip this.
export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <div className="page py-8 sm:py-12">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <div aria-hidden="true" className="h-12 w-2/3 max-w-xl animate-pulse rounded-xl bg-white" />
          <div aria-hidden="true" className="mt-4 h-5 w-full max-w-read animate-pulse rounded bg-white" />
          <div aria-hidden="true" className="mt-2 h-5 w-1/2 max-w-md animate-pulse rounded bg-white" />
          <div aria-hidden="true" className="mt-8 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
