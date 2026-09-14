import type { Metadata } from "next";
import Link from "next/link";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { EmptyState } from "@/components/EmptyState";
import { StanceBar, StanceLegend, STANCE_STYLE, WeekColumns } from "@/components/insights/SentimentCharts";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { formatDate, formatNumber } from "@/lib/format";
import { getSentimentOverview, STANCES, type CommentTopic } from "@/lib/sentiment";

/**
 * A chart color used for text, lightened in dark mode so it stays readable. --accent-lift comes from the
 * theme in globals.css; without it (0%) the color is unchanged.
 */
const readableAccent = (color: string) => `color-mix(in srgb, ${color}, #ffffff var(--accent-lift, 0%))`;

export const metadata: Metadata = {
  title: "What Fremont is saying",
  description: "Public comments residents filed on Fremont agenda items, counted by stance and theme, with the letters behind every number.",
};

// Read from the pipeline's tables per request: on Amplify, ISR regeneration runs after the response and its
// database reads time out when Lambda freezes, so the page kept its empty build-time copy. The static preview
// has no database and shows the empty state.
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");
const meetingDay = (date: string) => formatDate(`${date}T12:00:00-07:00`);

export default async function InsightsPage() {
  const overview = await getSentimentOverview();
  const hasData = Boolean(overview?.topics.length);

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-sky-mist">
        <section className="border-b border-rule bg-white">
          <div className="page py-8 sm:py-10">
            <p className="eyebrow">Public voice</p>
            <h1 className="display mt-2 text-[2.5rem] leading-tight sm:text-[3.25rem]">What Fremont is saying</h1>
            <p className="mt-2 max-w-read text-lg text-ink-soft">
              Letters and comments residents filed on city agenda items, read by Docket and counted by stance and theme. Every item links to the
              public record it came from.
            </p>
          </div>
        </section>

        <div className="page grid gap-6 py-6 sm:py-8">
          {!overview || !hasData ? (
            <EmptyState
              headline="No filed comments counted yet."
              body="Docket reads the public comments attached to Fremont agendas, such as letters in agenda packets and Zoning Administrator correspondence. When the next batch is read, where residents stand shows up here."
              actions={
                <Link href="/news" className="btn btn-secondary rounded-full">
                  See Fremont news
                </Link>
              }
            />
          ) : (
            <>
              <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Comments counted" value={formatNumber(overview.totals.comments)} />
                <Stat label="Agenda items" value={formatNumber(overview.totals.topics)} />
                <Stat label="Supporting" value={pct(overview.totals.support, overview.totals.comments)} tone={STANCE_STYLE.support.color} />
                <Stat label="Opposing" value={pct(overview.totals.oppose, overview.totals.comments)} tone={STANCE_STYLE.oppose.color} />
              </section>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Where residents stand" note="Across every agenda item with filed comments">
                  <Donut
                    title="Comments"
                    unit={["comment", "comments"]}
                    segments={STANCES.map((stance) => ({ key: stance, label: STANCE_STYLE[stance].label, value: overview.totals[stance], color: STANCE_STYLE[stance].color }))}
                  />
                </Card>
                <Card title="Comments over time" note="By the date written on each letter">
                  <WeekColumns weeks={overview.byWeek} />
                </Card>
                <Card title="What people raise most" note="Themes across all letters">
                  {overview.themes.length ? (
                    <BarList rows={overview.themes.map((t) => ({ key: t.theme, label: t.theme, value: t.count }))} color={STANCE_STYLE.mixed.color} />
                  ) : (
                    <p className="text-base text-ink-soft">No themes identified yet.</p>
                  )}
                </Card>
                <Card title="Where writers say they live" note="Only from what writers said about themselves; most letters don't say">
                  {overview.writerAreas.length ? (
                    <BarList rows={overview.writerAreas.map((a) => ({ key: a.label, label: a.label, value: a.count }))} color={STANCE_STYLE.neutral.color} />
                  ) : (
                    <p className="text-base text-ink-soft">None of the letters say where the writer lives.</p>
                  )}
                </Card>
                <Card title="Neighborhoods mentioned" note="Comments on items whose letters name each neighborhood, including places named as far away">
                  {overview.neighborhoods.length ? (
                    <BarList rows={overview.neighborhoods.map((n) => ({ key: n.slug, label: n.name, value: n.count }))} />
                  ) : (
                    <p className="text-base text-ink-soft">These letters don&apos;t name a specific neighborhood.</p>
                  )}
                </Card>
              </div>

              <section aria-labelledby="topics-title">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 id="topics-title" className="display text-[1.875rem] leading-tight sm:text-[2.25rem]">
                    By agenda item
                  </h2>
                  <StanceLegend />
                </div>
                <ul className="mt-4 grid gap-4">
                  {overview.topics.map((topic) => (
                    <TopicCard key={topic.id} topic={topic} />
                  ))}
                </ul>
              </section>
            </>
          )}

          <section aria-labelledby="method-title" className="rounded-2xl border border-rule bg-white p-5 text-base text-ink-soft">
            <h2 id="method-title" className="text-lg font-semibold text-ink">
              How these numbers are made
            </h2>
            <ul className="mt-2 grid gap-1.5">
              <li>Only comments filed in the public record count: letters in agenda packets and written correspondence to city bodies.</li>
              <li>
                An AI model{overview?.models.length ? ` (${overview.models.join(", ")})` : ""} reads each letter and labels its stance. Every quote is
                checked word for word against the document.
              </li>
              <li>Docket stores no names. Emails, phone numbers and street addresses are removed from quotes.</li>
              <li>These are residents&apos; opinions, not official votes or a scientific poll.</li>
            </ul>
            {overview?.updatedAt ? <p className="mt-3 text-sm text-ink-muted">Last updated {formatDate(overview.updatedAt)}.</p> : null}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-rule bg-white p-5">
      <p className="text-sm font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-[2rem] leading-none text-ink" style={tone ? { color: readableAccent(tone) } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-rule bg-white p-5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted">{note}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TopicCard({ topic }: { topic: CommentTopic }) {
  return (
    <li className="rounded-2xl border border-rule bg-white p-5 sm:p-6">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
        <span className="font-semibold text-ink-soft">{topic.body}</span>
        <span aria-hidden="true">·</span>
        <span>{topic.itemLabel}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={topic.meetingDate}>{meetingDay(topic.meetingDate)}</time>
      </p>
      <h3 className="mt-1 text-xl font-semibold leading-snug text-ink">{topic.title}</h3>
      {topic.neighborhoods.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-ink-muted">Mentions</span>
          {topic.neighborhoods.map((n) => (
            <Link key={n.slug} href={`/?feed=${n.slug}`} className="rounded-full bg-park-wash px-2.5 py-0.5 text-sm font-semibold text-park hover:underline">
              {n.name}
            </Link>
          ))}
        </p>
      ) : null}

      <StanceBar counts={topic.counts} total={topic.total} className="mt-4" />
      <p className="mt-1 text-sm text-ink-muted">
        {topic.total} filed {topic.total === 1 ? "comment" : "comments"}
      </p>

      {topic.themes.length ? (
        <ul aria-label="Themes" className="mt-4 flex flex-wrap gap-2">
          {topic.themes.map((theme) => (
            <li key={theme.theme} className="rounded-full border border-rule bg-sky-mist px-3 py-1 text-sm text-ink">
              {theme.theme} <span className="font-mono text-ink-muted">{theme.count}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {topic.excerpts.length ? (
        <ul aria-label="From the letters" className="mt-4 grid gap-3 md:grid-cols-3">
          {topic.excerpts.map((excerpt, i) => (
            <li key={`${excerpt.locator}-${i}`} className="rounded-xl border-l-4 bg-sky-mist/60 p-3" style={{ borderColor: STANCE_STYLE[excerpt.stance].color }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: readableAccent(STANCE_STYLE[excerpt.stance].color) }}>
                {STANCE_STYLE[excerpt.stance].label}
              </p>
              <blockquote className="mt-1 text-base leading-relaxed text-ink">“{excerpt.text}”</blockquote>
              <p className="mt-1.5 text-xs text-ink-muted">{[excerpt.authorArea, excerpt.sentAt ? formatDate(excerpt.sentAt) : null, excerpt.locator].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {topic.sourceUrl ? (
        <a href={topic.sourceUrl} target="_blank" rel="noopener noreferrer" className="link mt-4 inline-block text-sm">
          Read the filed comments
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </li>
  );
}
