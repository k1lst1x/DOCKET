import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoundaryMap } from "@/components/BoundaryMap";
import { ShareChatContext } from "@/components/chat/chat-context-store";
import { GroupNews } from "@/components/news/GroupNews";
import { EmptyState, Hills } from "@/components/EmptyState";
import { IssueBoard } from "@/components/issues/IssueBoard";
import { ItemRef } from "@/components/ItemRef";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getSession } from "@/lib/auth";
import { getGroup } from "@/lib/data";
import { getLiveGroup } from "@/lib/live-data";
import { formatDate, formatNumber } from "@/lib/format";
import { listMemberships } from "@/lib/members";
import type { Outcome } from "@/lib/types";

// Reads the signed-in member to show "You're a member" instead of Join.
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const group = getGroup((await params).slug);
  if (!group) return { title: "Group not found", robots: { index: false } };
  const description = `${group.description} See what ${group.name} is watching at Fremont city hall.`;
  return {
    title: group.name,
    description,
    alternates: { canonical: `/g/${group.slug}` },
    openGraph: { type: "website", title: `${group.name} · Docket`, description, url: `/g/${group.slug}` },
  };
}

async function membershipFor(slug: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  try {
    return (await listMemberships(session.memberId)).some((g) => g.slug === slug);
  } catch {
    return session.groups.some((g) => g.slug === slug);
  }
}

export default async function GroupPage({ params }: { params: Params }) {
  // Real open items, decisions and member counts from the database; the static preview keeps the saved samples.
  const group = await getLiveGroup((await params).slug);
  if (!group) notFound();

  const isMember = await membershipFor(group.slug);
  const joinHref = `/g/${group.slug}/join`;

  return (
    <>
      <ShareChatContext
        context={{
          kind: "group",
          label: "Neighborhood group",
          title: group.name,
          details: [
            `Fremont neighborhood: ${group.district}`,
            group.description,
            ...group.items.slice(0, 5).map((item) => `Watching: ${item.title} (${item.deadlineKind} ${item.deadline.slice(0, 10)})`),
            ...group.outcomes.slice(0, 2).map((outcome) => `Recently decided: ${outcome.title} (${outcome.result})`),
          ],
        }}
      />
      <div className="bg-gradient-to-b from-sky-top via-sky to-sky-haze">
        <SiteHeader tone="sky" />
        <section aria-labelledby="group-name" className="relative">
          <div className="page grid gap-10 pb-28 pt-8 sm:pb-32 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
            <div>
              <p className="eyebrow text-ink-soft">Fremont · {group.district}</p>
              <h1 id="group-name" className="display mt-3 text-[2.75rem] leading-[1.02] sm:text-[4rem]">
                {group.name}
              </h1>
              <p className="mt-5 max-w-read text-lg leading-relaxed text-ink-soft sm:text-xl">{group.description}</p>
              <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 border-y border-ink/20 py-5">
                <HeroStat label="Members" value={formatNumber(group.memberCount)} />
                <HeroStat label="Watching" value={String(group.items.length)} />
                <HeroStat label="Since" value={group.foundedOn.slice(0, 4)} />
              </dl>
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                {isMember ? (
                  <p className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-base font-semibold text-park">
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    You&apos;re a member
                  </p>
                ) : (
                  <Link href={joinHref} className="btn btn-primary rounded-full">
                    Join {group.name}
                  </Link>
                )}
                <span className="text-base text-ink-soft">
                  {isMember ? "Open any item below to vote." : "Free."} Meets {group.meets}.
                </span>
              </div>
              <Link
                href={`/news?area=${group.district.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-full border border-ink/25 bg-white/80 px-5 text-base font-semibold text-ink hover:bg-white"
              >
                <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d93025] opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#d93025]" />
                </span>
                {group.district} news, live
              </Link>
            </div>
            <figure className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
              <BoundaryMap label={`Map of the ${group.name} boundary`} boundary={group.boundary} className="h-72 sm:h-[26rem]" />
              <figcaption className="px-5 py-3 text-sm text-ink-soft">
                Boundary: the City of Fremont&apos;s {group.district} neighborhood area.
              </figcaption>
            </figure>
          </div>
          <Hills className="absolute inset-x-0 bottom-0 h-16 w-full sm:h-20" />
        </section>
      </div>

      <main id="main">
        <section aria-labelledby="watching" className="bg-white">
          <div className="page py-14 sm:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">At Fremont city hall</p>
                <h2 id="watching" className="display mt-2 text-[2.25rem] leading-tight sm:text-[2.75rem]">
                  What we&apos;re watching
                </h2>
              </div>
              {group.items.length ? (
                <p className="text-base text-ink-soft">Open an item for its summary, pros and cons, and the vote</p>
              ) : null}
            </div>
            {group.items.length ? (
              <IssueBoard items={group.items} />
            ) : (
              <EmptyState
                className="mt-8"
                headingLevel="h3"
                headline={`Nothing on the agenda for ${group.district} right now.`}
                body="Docket reads every Fremont agenda as it is posted. When something touches these streets, it shows up here before the deadline to weigh in."
              />
            )}
          </div>
        </section>

        <section aria-labelledby="group-news" className="border-t border-rule bg-sky-mist">
          <div className="page py-14 sm:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Around {group.district}</p>
                <h2 id="group-news" className="display mt-2 text-[2.25rem] leading-tight sm:text-[2.75rem]">
                  News and live incidents
                </h2>
              </div>
              <p className="text-base text-ink-soft">Open a story or incident to read it here, with a link to its source</p>
            </div>
            <GroupNews district={group.district} />
          </div>
        </section>

        <section aria-labelledby="outcomes" className="border-t border-rule bg-white">
          <div className="page py-14 sm:py-20">
            <p className="eyebrow">Decided</p>
            <h2 id="outcomes" className="display mt-2 text-[2.25rem] leading-tight sm:text-[2.75rem]">
              Recent outcomes
            </h2>
            {group.outcomes.length ? (
              <ul className="mt-8 divide-y divide-rule rounded-2xl border border-rule bg-sky-mist/40">
                {group.outcomes.map((outcome) => (
                  <OutcomeRow key={outcome.id} outcome={outcome} />
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-lg text-ink-soft">No decisions on this group&apos;s items yet.</p>
            )}
          </div>
        </section>

        {isMember ? null : (
          <section className="border-t border-rule bg-sky-mist">
            <div className="page py-14 sm:py-20">
              <EmptyState
                headline={`Join ${group.name}`}
                body={`Free, and no password. You'll see what's coming up for ${group.district} while there's still time to write a letter or show up.`}
                actions={
                  <Link href={joinHref} className="btn btn-primary rounded-full">
                    Join the group
                  </Link>
                }
              />
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className="mt-1 font-mono text-[1.625rem] leading-none text-ink">{value}</dd>
    </div>
  );
}

const RESULT_COLOR: Record<Outcome["result"], string> = {
  Approved: "text-park",
  "Approved with changes": "text-park",
  Denied: "text-signal",
  Continued: "text-ochre",
  Referred: "text-ochre",
  "Received and filed": "text-ink-soft",
  "No action": "text-ink-soft",
};

function OutcomeRow({ outcome }: { outcome: Outcome }) {
  const vote = outcome.vote;
  if (!vote) {
    return (
      <li className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-10">
        <OutcomeText outcome={outcome} />
        <div>
          <p className={`text-base font-semibold ${RESULT_COLOR[outcome.result]}`}>{outcome.result}</p>
          <p className="mt-2 text-sm text-ink-soft">The minutes don&apos;t list a vote count.</p>
        </div>
      </li>
    );
  }
  const { yes, no, abstain, absent } = vote;
  const total = yes + no + abstain + absent || 1;
  const tally = [`${yes} yes`, `${no} no`, abstain ? `${abstain} abstain` : "", absent ? `${absent} absent` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-10">
      <OutcomeText outcome={outcome} />
      <div>
        <p className="flex items-baseline justify-between gap-3">
          <span className={`text-base font-semibold ${RESULT_COLOR[outcome.result]}`}>{outcome.result}</span>
          <span className="font-mono text-sm text-ink">
            {yes}–{no}
          </span>
        </p>
        <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-rule">
          <span className="bg-park" style={{ width: `${(yes / total) * 100}%` }} />
          <span className="bg-signal" style={{ width: `${(no / total) * 100}%` }} />
          <span className="bg-ochre" style={{ width: `${(abstain / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-soft">{tally}</p>
        {outcome.groupPosition !== "No position" ? (
          <p className="mt-2 text-sm">
            <span className="text-ink-muted">Group position: </span>
            <span className="font-semibold text-ink">{outcome.groupPosition}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function OutcomeText({ outcome }: { outcome: Outcome }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ItemRef value={outcome.ref} />
        <time dateTime={outcome.decidedOn} className="font-mono text-sm text-ink-soft">
          {formatDate(`${outcome.decidedOn}T12:00:00-07:00`)}
        </time>
      </div>
      <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">{outcome.title}</h3>
      <p className="mt-1 text-base text-ink-soft">{outcome.body}</p>
      {outcome.note ? <p className="reading mt-2 text-ink-soft">{outcome.note}</p> : null}
      {outcome.sourceUrl ? (
        <a href={outcome.sourceUrl} target="_blank" rel="noopener noreferrer" className="link mt-2 inline-block text-sm">
          Read the minutes
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}
