import Link from "next/link";
import { AddressField } from "@/components/AddressField";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { formatMonthDay, plural } from "@/lib/format";
import { getLiveWeeklyStats } from "@/lib/live-data";
import type { WeeklyStats } from "@/lib/types";

export const revalidate = 300;

// Home: the neighborhood feed, with finding your group and the rest of Docket alongside.
export default async function Home() {
  const stats = await getLiveWeeklyStats();

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <h1 className="sr-only">Docket: talk with your Fremont neighbors</h1>
        <div className="page grid gap-6 py-5 sm:py-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <HomeFeed />

          <aside aria-label="Find your group and more" className="grid content-start gap-4 lg:sticky lg:top-4">
            <section className="rounded-2xl border border-rule bg-white p-5">
              <form action="/find" method="get" role="search">
                <h2 className="text-lg font-semibold leading-snug text-ink">
                  <label htmlFor="address">Where do you live?</label>
                </h2>
                <p id="address-hint" className="mt-1 text-sm text-ink-soft">
                  Find your neighborhood group with a Fremont street address or the nearest cross street.
                </p>
                <AddressField apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""} />
                <button type="submit" className="btn btn-primary mt-2 h-11 w-full rounded-full">
                  Find my group
                </button>
              </form>
            </section>

            {stats ? <StatCard stats={stats} /> : null}

            <nav aria-label="Explore Docket" className="rounded-2xl border border-rule bg-white p-2">
              {[
                { href: "/news", icon: "🗞️", title: "Fremont news", body: "Police, fire, traffic and city hall, live" },
                { href: "/insights", icon: "📊", title: "What Fremont is saying", body: "Where residents stand on city agenda items" },
                { href: "/places", icon: "🗺️", title: "Places map", body: "Schools, food, issues and live incidents" },
                { href: "/groups", icon: "🏘️", title: "Neighborhood groups", body: "What each group is watching" },
                { href: "/chat", icon: "💬", title: "Ask Docket", body: "Questions about city documents" },
              ].map((link) => (
                <Link key={link.href} href={link.href} className="flex items-center gap-3 rounded-xl p-3 hover:bg-sky-mist">
                  <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-mist text-lg">
                    {link.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{link.title}</span>
                    <span className="block text-sm text-ink-soft">{link.body}</span>
                  </span>
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function StatCard({ stats }: { stats: WeeklyStats }) {
  const when = stats.isCurrentWeek ? "this week" : `in the week ending ${formatMonthDay(stats.windowEnd)}`;
  if (stats.source === "live") {
    return (
      <section className="rounded-2xl border border-rule bg-white p-5">
        <p className="font-serif text-lg leading-snug text-ink">
          Docket read <strong className="font-semibold">{plural(stats.documentsRead, "public document")}</strong> {when}
          {stats.itemsSurfaced ? (
            <>
              {" "}
              and surfaced <strong className="font-semibold">{plural(stats.itemsSurfaced, "item")}</strong> across{" "}
              <strong className="font-semibold">{plural(stats.neighborhoods, "neighborhood")}</strong>
            </>
          ) : null}
          .
        </p>
        <p className="mt-2 text-sm text-ink-muted">Agendas, minutes, staff reports, bills and local news. Updated every morning.</p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-rule bg-white p-5">
      <p className="font-serif text-lg leading-snug text-ink">
        Docket read <strong className="font-semibold">{plural(stats.pagesRead, "page")}</strong> of city documents {when} and surfaced{" "}
        <strong className="font-semibold">{plural(stats.itemsSurfaced, "thing")}</strong> across{" "}
        <strong className="font-semibold">{plural(stats.neighborhoods, "neighborhood")}</strong>.
      </p>
      {stats.source === "sample" ? <p className="mt-2 text-sm text-ink-muted">Sample data</p> : null}
    </section>
  );
}
