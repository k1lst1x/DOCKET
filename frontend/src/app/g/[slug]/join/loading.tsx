import { SiteHeader } from "@/components/SiteHeader";

// Shown the moment a "Join" button is pressed, while the join page checks your membership, so the
// button never looks like it did nothing.
export default function JoinLoading() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <div className="page py-8 sm:py-14">
          <div className="mx-auto max-w-3xl rounded-2xl border border-rule bg-white p-6 sm:p-10">
            <p role="status" className="eyebrow">
              Opening the join page…
            </p>
            <div aria-hidden="true" className="mt-4 h-12 w-3/4 animate-pulse rounded-xl bg-sky-mist" />
            <div aria-hidden="true" className="mt-4 h-5 w-full animate-pulse rounded bg-sky-mist" />
            <div aria-hidden="true" className="mt-2 h-5 w-2/3 animate-pulse rounded bg-sky-mist" />
            <div aria-hidden="true" className="mt-8 grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-sky-mist" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
