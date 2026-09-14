import { Hills } from "@/components/EmptyState";
import { SiteHeader } from "@/components/SiteHeader";

// Shown the moment a group link is pressed, while the group page reads its items and your membership,
// so the tap answers at once. Laid out like the group page so nothing jumps when it arrives.
export default function GroupLoading() {
  return (
    <>
      <div className="bg-gradient-to-b from-sky-top via-sky to-sky-haze">
        <SiteHeader tone="sky" />
        <section className="relative">
          <div className="page grid gap-10 pb-28 pt-8 sm:pb-32 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
            <div>
              <p role="status" className="eyebrow text-ink-soft">
                Opening the group…
              </p>
              <div aria-hidden="true" className="mt-4 h-14 w-3/4 animate-pulse rounded-xl bg-white/50 sm:h-16" />
              <div aria-hidden="true" className="mt-6 h-5 w-full max-w-read animate-pulse rounded bg-white/50" />
              <div aria-hidden="true" className="mt-2 h-5 w-2/3 animate-pulse rounded bg-white/50" />
              <div aria-hidden="true" className="mt-8 h-20 max-w-md animate-pulse rounded-xl bg-white/40" />
              <div aria-hidden="true" className="mt-8 h-12 w-48 animate-pulse rounded-full bg-white/60" />
            </div>
            <div aria-hidden="true" className="h-72 animate-pulse rounded-2xl border border-ink/10 bg-white/60 sm:h-[26rem]" />
          </div>
          <Hills className="absolute inset-x-0 bottom-0 h-16 w-full sm:h-20" />
        </section>
      </div>
      <main id="main" className="bg-white">
        <div className="page py-14 sm:py-20">
          <div aria-hidden="true" className="h-4 w-32 animate-pulse rounded bg-sky-mist" />
          <div aria-hidden="true" className="mt-3 h-11 w-72 max-w-full animate-pulse rounded-xl bg-sky-mist" />
          <div aria-hidden="true" className="mt-8 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-sky-mist" />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
