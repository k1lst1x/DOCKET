import Link from "next/link";
import { HeroIllustration } from "@/components/HeroIllustration";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getWeeklyStats } from "@/lib/data";
import { formatMonthDay, plural } from "@/lib/format";
import type { WeeklyStats } from "@/lib/types";

export const revalidate = 300;

export default function Home() {
  const stats = getWeeklyStats();

  return (
    <>
      <div className="relative flex min-h-[100svh] flex-col overflow-hidden bg-[linear-gradient(180deg,#8DC2F5_0%,#A9D1F6_32%,#CFE4F7_62%,#DDEBF6_100%)]">
        <SiteHeader tone="sky" />
        <main id="main" className="relative z-10 flex flex-1 flex-col">
          <div className="page flex flex-col items-center pb-6 pt-8 text-center sm:pt-14">
            <p className="max-w-[40rem] text-lg leading-relaxed text-ink-soft sm:text-xl">
              Docket reads every Fremont city-hall agenda and tells your neighborhood group what touches your streets,
              while there is still time to speak up.
            </p>

            <form action="/find" method="get" role="search" className="mt-6 w-full sm:mt-8">
              <h1 className="display text-[2.75rem] leading-[1.02] sm:text-[4.5rem] lg:text-[5.25rem]">
                <label htmlFor="address">Where do you live?</label>
              </h1>
              <div className="mx-auto mt-8 flex max-w-[40rem] flex-col gap-3 sm:flex-row">
                <input
                  id="address"
                  name="address"
                  type="text"
                  required
                  autoComplete="street-address"
                  placeholder="37600 Niles Blvd, Fremont"
                  aria-describedby="address-hint"
                  className="field h-14 w-full border-ink/60 text-lg sm:h-16 sm:flex-1 sm:text-xl"
                />
                <button type="submit" className="btn btn-primary h-14 px-8 text-lg sm:h-16">
                  Find my group
                </button>
              </div>
              <p id="address-hint" className="mt-3 text-base text-ink-soft">
                A Fremont street address or the nearest cross street.
              </p>
            </form>

            {stats ? <StatLine stats={stats} /> : null}
          </div>

          <div className="relative mt-auto aspect-[5/2] w-full shrink-0">
            <HeroIllustration className="absolute inset-0 h-full w-full" />
          </div>
        </main>
      </div>
      <SiteFooter />
    </>
  );
}

function StatLine({ stats }: { stats: WeeklyStats }) {
  const when = stats.isCurrentWeek ? "this week" : `in the week ending ${formatMonthDay(stats.windowEnd)}`;
  return (
    <div className="mt-10 sm:mt-12">
      <p className="mx-auto max-w-[46rem] font-serif text-[1.5rem] leading-[1.35] text-ink sm:text-[2rem]">
        Docket read <strong className="font-semibold">{plural(stats.pagesRead, "page")}</strong> of city documents {when}{" "}
        and surfaced <strong className="font-semibold">{plural(stats.itemsSurfaced, "thing")}</strong> across{" "}
        <strong className="font-semibold">{plural(stats.neighborhoods, "neighborhood")}</strong>.
      </p>
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-base text-ink-soft">
        {stats.source === "sample" ? (
          <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-sm font-semibold text-ink">Sample data</span>
        ) : null}
        <Link href="/groups" className="link">
          See the groups
        </Link>
      </p>
    </div>
  );
}
