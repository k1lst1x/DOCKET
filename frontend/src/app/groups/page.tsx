import type { Metadata } from "next";
import Link from "next/link";
import { Deadline } from "@/components/Deadline";
import { EmptyState } from "@/components/EmptyState";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { formatMonthDay, formatNumber, plural } from "@/lib/format";
import { listLiveGroups } from "@/lib/live-data";
import { getActivityCounts, type ActivityCounts } from "@/lib/neighborhood-activity";

export const metadata: Metadata = {
  title: "Neighborhood groups in Fremont",
  description: "Every Fremont neighborhood group on Docket, with the most urgent city-hall item each one is watching.",
};

// Rendered per request: on Amplify the build has no database access and ISR never replaced that copy
// (x-nextjs-cache stayed STALE), so the directory showed no activity. Its three queries are small.
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const [{ groups: listed, citywideCount }, counts] = await Promise.all([listLiveGroups(), getActivityCounts()]);
  const activityOf = (district: string) => counts?.get(district) ?? null;
  // Members first, then open items, then the neighborhoods where residents are filing the most requests.
  const groups = [...listed].sort(
    (a, b) =>
      b.memberCount - a.memberCount ||
      Number(Boolean(b.urgentItem)) - Number(Boolean(a.urgentItem)) ||
      (activityOf(b.district)?.reportsLast30Days ?? 0) - (activityOf(a.district)?.reportsLast30Days ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const totals = counts ? [...counts.values()].reduce((sum, c) => ({ reports: sum.reports + c.reportsLast30Days, projects: sum.projects + c.projects }), { reports: 0, projects: 0 }) : null;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="border-b border-rule bg-sky-mist">
          <div className="page py-10 sm:py-14">
            <p className="eyebrow">Directory</p>
            <h1 className="display mt-2 text-[2.5rem] leading-tight sm:text-[3.5rem]">Neighborhood groups in Fremont</h1>
            <p className="mt-3 max-w-read text-lg text-ink-soft">
              Every one of Fremont&apos;s {groups.length} official neighborhoods has a group. Each one hears about the city-hall items
              that touch its streets{citywideCount ? `, plus ${plural(citywideCount, "citywide item")} open to everyone right now` : ""}.
              {totals && totals.reports
                ? ` Residents filed ${plural(totals.reports, "Fremont App request")} in the last 30 days, and the city has ${plural(totals.projects, "project")} mapped across these neighborhoods.`
                : ""}
            </p>
          </div>
        </section>

        <div className="page py-8 sm:py-12">
          {groups.length ? (
            <ul className="divide-y divide-rule border-y border-rule">
              {groups.map((g) => (
                <li key={g.slug} className="grid gap-4 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-10">
                  <div>
                    <h2 className="text-xl font-semibold leading-snug">
                      <Link href={`/g/${g.slug}`} className="rounded-sm hover:underline hover:underline-offset-4">
                        {g.name}
                      </Link>
                    </h2>
                    <p className="mt-1 text-base text-ink-soft">{g.description}</p>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                      {g.memberCount ? (
                        <span>
                          <span className="font-mono text-ink">{formatNumber(g.memberCount)}</span> {g.memberCount === 1 ? "member" : "members"}
                        </span>
                      ) : (
                        <Link href={`/g/${g.slug}/join`} className="link text-sm">
                          Be the first to join
                        </Link>
                      )}
                    </p>
                  </div>
                  <div className="md:border-l md:border-rule md:pl-8">
                    {g.urgentItem ? (
                      <>
                        <p className="eyebrow">Most urgent</p>
                        <p className="mt-1 font-semibold leading-snug text-ink">{g.urgentItem.title}</p>
                        <div className="mt-1">
                          <Deadline at={g.urgentItem.deadline} label={g.urgentItem.deadlineKind} />
                        </div>
                      </>
                    ) : activityOf(g.district) ? (
                      <GroupActivity counts={activityOf(g.district)!} />
                    ) : (
                      <p className="text-base text-ink-muted">Nothing with an open deadline right now.</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              headline="No groups yet."
              body="Fremont doesn't have a neighborhood group on Docket yet. Look up your address to start the first one."
              actions={
                <Link href="/app#address"className="btn btn-primary">
                  Look up my address
                </Link>
              }
            />
          )}

          <p className="mt-10 text-base text-ink-soft">
            Don&apos;t see your block?{" "}
            <Link href="/app#address"className="link">
              Look up your address
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function GroupActivity({ counts }: { counts: ActivityCounts }) {
  return (
    <>
      <p className="eyebrow">Last 30 days</p>
      <p className="mt-1 text-base leading-snug text-ink">
        <span className="font-semibold">{plural(counts.reportsLast30Days, "request")}</span> to the city on the Fremont App
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {[plural(counts.projects, "city project"), counts.development ? plural(counts.development, "development site") : null].filter(Boolean).join(" · ")}
        {counts.latestReport ? ` · Latest: ${counts.latestReport.category}, ${formatMonthDay(counts.latestReport.reportedAt)}` : ""}
      </p>
    </>
  );
}
