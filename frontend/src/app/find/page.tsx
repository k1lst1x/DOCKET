import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BoundaryMap } from "@/components/BoundaryMap";
import { Deadline } from "@/components/Deadline";
import { EmptyState } from "@/components/EmptyState";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { findGroups } from "@/lib/data";
import { countWord, formatNumber } from "@/lib/format";
import type { FindResult, GeocodedPoint, NearbyGroup, UnresolvedReason } from "@/lib/types";

export const metadata: Metadata = { title: "Find your group", robots: { index: false } };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ address?: string | string[] }>;

export default async function FindPage({ searchParams }: { searchParams: SearchParams }) {
  const { address } = await searchParams;
  const result = await findGroups((Array.isArray(address) ? address[0] : address) ?? "");

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-white">
        <div className="page py-10 sm:py-14">
          {result.status === "match" ? <MatchView result={result} /> : null}
          {result.status === "nearby" ? <NearbyView result={result} /> : null}
          {result.status === "none" ? <NoneView result={result} /> : null}
          {result.status === "unresolved" ? <CrossStreetView query={result.query} reason={result.reason} /> : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const startHref = (point: GeocodedPoint) => `/start?address=${encodeURIComponent(point.matchedAddress)}`;
const pin = (point: GeocodedPoint) => ({ lat: point.lat, lng: point.lng, label: point.matchedAddress });

function formatDistance(km: number) {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away` : `${km.toFixed(1)} km away`;
}

function PlacedNote({ point }: { point: GeocodedPoint }) {
  return (
    <p className="text-base text-ink-soft">
      The red pin is <span className="font-semibold text-ink">{point.matchedAddress}</span>.{" "}
      <Link href="/#address" className="link">
        Not your place? Search again
      </Link>
    </p>
  );
}

function MatchView({ result }: { result: Extract<FindResult, { status: "match" }> }) {
  const { match: group, point, nearby } = result;
  return (
    <div>
      <p className="eyebrow">Your neighborhood group</p>
      <h1 className="display mt-2 text-[2.25rem] leading-tight sm:text-[3.25rem]">You&apos;re inside {group.name}.</h1>
      <div className="mt-3">
        <PlacedNote point={point} />
      </div>

      <article aria-labelledby="match-name" className="card mt-8 grid overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <BoundaryMap
          label={`Map of the ${group.name} boundary with your location`}
          boundary={group.boundary}
          point={pin(point)}
          className="h-72 border-b border-rule sm:h-96 lg:h-full lg:min-h-[30rem] lg:border-b-0 lg:border-r"
        />
        <div className="flex flex-col p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="match-name" className="display text-[1.875rem] leading-tight">
              {group.name}
            </h2>
            <p className="text-base text-ink-soft">
              <span className="font-mono text-ink">{formatNumber(group.memberCount)}</span> members
            </p>
          </div>
          <p className="mt-2 text-ink-soft">{group.description}</p>

          <h3 className="eyebrow mt-7">Watching right now</h3>
          {group.items.length ? (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {group.items.slice(0, 3).map((item) => (
                <li key={item.id} className="py-4">
                  <p className="font-semibold leading-snug text-ink">{item.title}</p>
                  <p className="reading mt-1 text-ink-soft">{item.brief}</p>
                  <div className="mt-2">
                    <Deadline at={item.deadline} label={item.deadlineKind} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-ink-soft">
              Nothing on the agenda for {group.district} right now. Members hear first when that changes.
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/g/${group.slug}/join`} className="btn btn-primary">
              Join {group.name}
            </Link>
            <Link href={`/g/${group.slug}`} className="btn btn-secondary">
              See the group page
            </Link>
          </div>
        </div>
      </article>

      {nearby.length ? (
        <section aria-labelledby="also-nearby" className="mt-12">
          <h2 id="also-nearby" className="display text-[1.75rem]">
            Also close by
          </h2>
          <NearbyList groups={nearby} />
        </section>
      ) : null}
    </div>
  );
}

function NearbyView({ result }: { result: Extract<FindResult, { status: "nearby" }> }) {
  const { point, nearby } = result;
  const count = nearby.length;
  const closeBy = `${countWord(count).replace(/^./, (c) => c.toUpperCase())} ${count === 1 ? "is" : "are"} close by.`;

  return (
    <div>
      <h1 className="display text-[2.25rem] leading-tight sm:text-[3.25rem]">
        No group covers your block yet. {closeBy}
      </h1>
      <div className="mt-3">
        <PlacedNote point={point} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <BoundaryMap
            label="Map of your location and the nearest group boundaries"
            others={nearby.map((g) => ({ name: g.name, boundary: g.boundary }))}
            point={pin(point)}
            className="h-80 lg:h-full lg:min-h-[26rem]"
          />
        </div>
        <NearbyList groups={nearby} />
      </div>

      <EmptyState
        className="mt-12"
        headline="Start one for your block"
        body={
          <>
            A group can be as small as one street. The Clerk helps you draw a boundary around{" "}
            <span className="font-semibold text-ink">{point.matchedAddress}</span>, choose what to watch at city hall, and
            invite the neighbors you already know.
          </>
        }
        actions={
          <Link href={startHref(point)} className="btn btn-primary">
            Start one for your block
          </Link>
        }
      />
    </div>
  );
}

function NearbyList({ groups }: { groups: NearbyGroup[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {groups.map((g) => (
        <li key={g.slug} className="py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-xl font-semibold leading-snug">
              <Link href={`/g/${g.slug}`} className="rounded-sm hover:underline hover:underline-offset-4">
                {g.name}
              </Link>
            </h3>
            <span className="font-mono text-sm text-ink-soft">{formatDistance(g.distanceKm)}</span>
          </div>
          <p className="mt-1 text-base text-ink-soft">
            {g.description} <span className="whitespace-nowrap">· {formatNumber(g.memberCount)} members</span>
          </p>
          {g.urgentItem ? (
            <p className="mt-3 text-base">
              <span className="font-semibold text-ink">{g.urgentItem.title}</span>
              <span className="mt-1 block">
                <Deadline at={g.urgentItem.deadline} label={g.urgentItem.deadlineKind} />
              </span>
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/g/${g.slug}/join`} className="btn btn-primary h-11 px-5">
              Join
            </Link>
            <Link href={`/g/${g.slug}`} className="btn btn-secondary h-11 px-5">
              View group
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NoneView({ result }: { result: Extract<FindResult, { status: "none" }> }) {
  const { point } = result;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-stretch">
      <EmptyState
        headingLevel="h1"
        headline="Be the first group on your block."
        body={
          <>
            <p>
              Nobody on Docket covers <span className="font-semibold text-ink">{point.matchedAddress}</span> yet. Most of
              Fremont doesn&apos;t have a group, and this is how every group starts.
            </p>
            <p className="mt-3">
              The Clerk walks you through it in a few minutes: draw your boundary, pick what to watch at city hall, and invite
              the neighbors you already know.
            </p>
          </>
        }
        actions={
          <>
            <Link href={startHref(point)} className="btn btn-primary">
              Start one for your block
            </Link>
            <Link href="/groups" className="btn btn-secondary">
              Browse all groups
            </Link>
          </>
        }
      />
      <figure className="card flex flex-col overflow-hidden">
        <BoundaryMap label="Map of your location" point={pin(point)} className="h-80 flex-1 lg:min-h-[24rem]" />
        <figcaption className="border-t border-rule px-5 py-3">
          <PlacedNote point={point} />
        </figcaption>
      </figure>
    </div>
  );
}

const CROSS_STREET_COPY: Record<UnresolvedReason, { headline: string; body: (query: string) => ReactNode }> = {
  empty: {
    headline: "Where do you live?",
    body: () => "Type a Fremont street address, or just the nearest cross street.",
  },
  not_found: {
    headline: "Which cross street are you near?",
    body: (q) => (
      <>
        We couldn&apos;t pin <span className="font-semibold text-ink">“{q}”</span> to a spot on the map. The nearest
        intersection works just as well.
      </>
    ),
  },
  unavailable: {
    headline: "Which cross street are you near?",
    body: () => "The address lookup is slow to answer right now. Two street names usually get through.",
  },
  outside_city: {
    headline: "Is that in Fremont?",
    body: (q) => (
      <>
        <span className="font-semibold text-ink">“{q}”</span> looks like it&apos;s outside Fremont. Docket reads Fremont city
        hall for now. Try a Fremont address or cross street.
      </>
    ),
  },
};

function CrossStreetView({ query, reason }: { query: string; reason: UnresolvedReason }) {
  const copy = CROSS_STREET_COPY[reason];
  return (
    <section className="mx-auto max-w-read">
      <h1 className="display text-[2.25rem] leading-tight sm:text-[3rem]">{copy.headline}</h1>
      <p className="mt-4 text-lg text-ink-soft">{copy.body(query)}</p>
      <form action="/find" method="get" role="search" className="mt-8">
        <label htmlFor="cross-street" className="label">
          {reason === "empty" ? "Address or cross street" : "Nearest cross street"}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="cross-street"
            name="address"
            type="text"
            required
            autoComplete="off"
            placeholder="Mowry Ave and Fremont Blvd"
            aria-describedby="cross-street-hint"
            className="field w-full sm:flex-1"
          />
          <button type="submit" className="btn btn-primary">
            Find my group
          </button>
        </div>
        <p id="cross-street-hint" className="mt-3 text-base text-ink-soft">
          Two street names are enough, like “Niles Blvd and G St”.
        </p>
      </form>
    </section>
  );
}
