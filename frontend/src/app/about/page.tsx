import type { Metadata } from "next";
import { Silkscreen } from "next/font/google";
import Link from "next/link";
import { HeroFlock } from "@/components/pixel/HeroFlock";
import { NeighborhoodScene } from "@/components/pixel/NeighborhoodScene";
import { NightScene } from "@/components/pixel/NightScene";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import styles from "./about.module.css";

const pixel = Silkscreen({ subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "About",
  description:
    "Docket is the neighborhood app for Fremont, California: a feed for neighbors, local news and live incidents, a places map, neighborhood groups and community votes, with an AI agent that reads city hall and cites its sources.",
};

const SOURCES = [
  "City Council agendas",
  "Planning Commission minutes",
  "Staff reports",
  "FUSD board meetings",
  "Fremont App service requests",
  "California bills",
  "City of Fremont news",
  "Tri-City Voice",
  "Patch Fremont",
  "r/Fremont",
  "CHP incidents",
  "Caltrans lane closures",
  "USGS earthquakes",
  "CAL FIRE",
  "National Weather Service alerts",
  "Power outages",
];

const STEPS: { icon: PixelIconName; title: string; body: string }[] = [
  {
    icon: "groups",
    title: "Find your block",
    body: "Enter a Fremont street address or the nearest cross street. Docket places you in one of the city's 32 official neighborhoods and shows its group. Joining takes an emailed code, no password.",
  },
  {
    icon: "reads",
    title: "Docket keeps watch",
    body: "In the background it reads agendas, minutes, staff reports, school board meetings and state bills, and gathers local news plus traffic, fire, earthquake, weather and outage alerts for Fremont.",
  },
  {
    icon: "tells",
    title: "Your block weighs in",
    body: "Talk with neighbors in the feed, open any story or incident without leaving Docket, vote on local issues, and ask about what's on your screen, with sources you can check.",
  },
];

const FEATURES: { icon: PixelIconName; href: string; title: string; body: string }[] = [
  {
    icon: "feed",
    href: "/",
    title: "Neighborhood feed",
    body: "Post to your neighborhood or all of Fremont with photos, a short video, links and emoji. Reply, like and watch new posts arrive.",
  },
  {
    icon: "groups",
    href: "/groups",
    title: "Neighborhood groups",
    body: "Find your group by address, join with an email code, and follow what city hall has on the agenda for your area.",
  },
  {
    icon: "places",
    href: "/places",
    title: "Places map",
    body: "Explore schools, parks, restaurants and more in any neighborhood, with photos, hours and ratings on Google Maps.",
  },
  {
    icon: "news",
    href: "/news",
    title: "Fremont news",
    body: "Stories about city hall, police, fire, housing and traffic, filtered to Fremont and searchable by neighborhood, topic and source.",
  },
  {
    icon: "tells",
    href: "/places",
    title: "Live incidents",
    body: "CHP calls, Caltrans lane closures, earthquakes, wildfires, weather alerts and power outages near Fremont, refreshed every minute.",
  },
  {
    icon: "votes",
    href: "/groups",
    title: "Community votes",
    body: "Take a stance on a local issue, read pros and cons that cite their sources, and review it for your neighbors.",
  },
  {
    icon: "chat",
    href: "/chat",
    title: "Ask Docket",
    body: "Ask about Fremont's public records in plain language and get answers with numbered sources. It knows which page or story you have open.",
  },
  {
    icon: "reads",
    href: "/groups",
    title: "City hall, read for you",
    body: "An AI agent works through council and planning agendas, minutes, school board meetings and state bills, and turns them into short, cited updates.",
  },
  {
    icon: "checks",
    href: "/",
    title: "Safe to share",
    body: "Posts, reviews, names, photos and videos are checked for abuse, including disguised words and disguised files, before neighbors see them.",
  },
];

const PRINCIPLES = [
  {
    mark: "§",
    title: "Every claim links to the record",
    body: "Agent summaries and answers cite the agenda, minutes or report they came from, and a fact that isn't in its source gets removed. Docket points you to the public record; it doesn't replace it.",
  },
  {
    mark: "✓",
    title: "Neighbors' votes are opinions",
    body: "Community polls show how residents feel. They are never presented as official council votes.",
  },
  {
    mark: "!",
    title: "Checked before neighbors see it",
    body: "Words, photos and videos go through automatic checks first. If a file can't be checked, it isn't shown.",
  },
  {
    mark: "#",
    title: "Sample data says so",
    body: "Groups, agenda items, posts and votes that aren't live yet are clearly marked as sample data.",
  },
];

const STACK = [
  "Strands Agents",
  "Amazon Bedrock AgentCore",
  "Aurora DSQL",
  "Amazon S3 Vectors",
  "Amazon Cognito",
  "Amazon Rekognition",
  "Next.js on AWS Amplify",
  "Google Maps Platform",
];

export default function AboutPage() {
  return (
    <>
      <div className="bg-sky-top">
        <SiteHeader tone="sky" />
        <main id="main">
          {/* Clipped sideways only, so birds can leave through the edges and rise above the hero. */}
          <div className={`relative overflow-x-clip ${styles.sky}`}>
          <HeroFlock />
          <section aria-labelledby="about-title" className="page pt-6 text-center sm:pt-12">
            <p className={`${pixel.className} inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-sm text-ink`}>
              <span aria-hidden="true" className="h-2 w-2 bg-park-leaf" />
              Made for Fremont, California
            </p>
            <h1 id="about-title" className="display mx-auto mt-5 max-w-3xl text-[2.5rem] leading-[1.05] sm:text-[4rem]">
              Your whole neighborhood, in one place.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              Docket is where Fremont neighbors talk, catch local news and live incidents, explore places nearby and weigh in on what
              city hall is deciding. Its AI agent reads the public record for you and cites every source.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/#address" className="btn btn-primary rounded-full">
                Find your group
              </Link>
              <Link href="/" className="btn btn-secondary rounded-full border-ink/30 bg-white/70">
                Open the neighborhood feed
              </Link>
            </div>
          </section>

          <NeighborhoodScene className="mt-8 aspect-[5/4] w-full sm:mt-10 sm:aspect-[2/1] lg:aspect-[3/1] lg:max-h-[34rem]" />
          </div>

          <div className={`${styles.bedrock} ${styles.marqueeWrap} overflow-hidden py-4 text-snow`}>
            <p className="sr-only">Docket keeps up with: {SOURCES.join(", ")}.</p>
            <div aria-hidden="true" className={styles.marquee}>
              {[0, 1].map((copy) => (
                <ul key={copy} className="flex shrink-0 items-center">
                  {SOURCES.map((source) => (
                    <li key={source} className="flex items-center gap-4 whitespace-nowrap pr-4 font-mono text-sm">
                      <span className="inline-block h-2 w-2 bg-park-leaf" />
                      {source}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>

          <div className="bg-white">
            <section aria-labelledby="why-title" className={`page grid gap-10 py-16 sm:py-24 lg:grid-cols-2 lg:items-center ${styles.reveal}`}>
              <div>
                <p className={`${pixel.className} text-sm text-park`}>The problem</p>
                <h2 id="why-title" className="display mt-3 text-[2rem] leading-tight sm:text-[2.75rem]">
                  Keeping up with your own street shouldn&apos;t be a part-time job.
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                  City decisions hide in agenda packets and meeting minutes. Road closures, fires and outages sit on state and federal
                  feeds. Local stories are spread across several news sites, and neighbors talk in group chats and forums. By the time it
                  all adds up, the meeting is over and the chance to speak has passed.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-rule bg-sky-mist p-6">
                  <p className="eyebrow">Without Docket</p>
                  <ul className="mt-4 grid gap-3 text-base text-ink-soft">
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Check city sites, news sites and alert feeds one by one
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Read long agenda packets to find one item
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Hear about it from a neighbor, after the fact
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-park/30 bg-park-wash p-6">
                  <p className="eyebrow text-park">With Docket</p>
                  <ul className="mt-4 grid gap-3 text-base text-ink">
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      One feed for your neighbors and your neighborhood
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      News, incidents and city hall, sorted for your area
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      Plain summaries with sources, before the deadline
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <section aria-labelledby="how-title" className="border-y border-rule bg-sky-mist">
            <div className={`page py-16 sm:py-24 ${styles.reveal}`}>
              <p className={`${pixel.className} text-center text-sm text-park`}>How it works</p>
              <h2 id="how-title" className="display mx-auto mt-3 max-w-2xl text-center text-[2rem] leading-tight sm:text-[2.75rem]">
                Neighbors talk. Docket keeps watch.
              </h2>

              <div aria-hidden="true" className={`relative mx-[16%] mt-12 hidden h-5 md:block ${styles.courierTrack}`}>
                <span className={`absolute top-0 grid h-5 w-5 place-items-center ${styles.courierPaper}`}>
                  <PixelIcon name="reads" className="h-5 w-5" />
                </span>
              </div>

              <ol className="mt-8 grid gap-5 md:mt-6 md:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li key={step.title} className={`relative rounded-2xl border-2 border-ink bg-white p-6 ${styles.pixelShadow}`}>
                    <div className="flex items-center justify-between">
                      <span className="grid h-14 w-14 place-items-center rounded-xl bg-sky-mist">
                        <PixelIcon name={step.icon} />
                      </span>
                      <span className={`${pixel.className} text-2xl text-ink/25`}>0{i + 1}</span>
                    </div>
                    <h3 className="mt-5 text-xl font-semibold text-ink">{step.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-ink-soft">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section aria-labelledby="features-title" className="bg-white">
            <div className={`page py-16 sm:py-24 ${styles.reveal}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className={`${pixel.className} text-sm text-park`}>What you can do</p>
                  <h2 id="features-title" className="display mt-3 max-w-xl text-[2rem] leading-tight sm:text-[2.75rem]">
                    Talk, explore, stay informed and speak up.
                  </h2>
                </div>
              </div>
              <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((feature) => (
                  <li key={feature.title}>
                    <Link
                      href={feature.href}
                      className="group flex h-full gap-4 rounded-2xl border border-rule bg-white p-5 transition-colors hover:border-ink hover:bg-sky-mist"
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sky-mist transition-transform group-hover:-translate-y-1 group-hover:bg-white">
                        <PixelIcon name={feature.icon} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold text-ink">
                          {feature.title}
                          <span aria-hidden="true" className="ml-1 inline-block transition-transform group-hover:translate-x-1">
                            →
                          </span>
                        </span>
                        <span className="mt-1 block text-base leading-relaxed text-ink-soft">{feature.body}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Always a dark green panel, in both themes, so its text uses snow rather than white. */}
          <section aria-labelledby="principles-title" className="bg-park-deep text-snow">
            <div className={`page py-16 sm:py-24 ${styles.reveal}`}>
              <p className={`${pixel.className} text-sm text-[#86C45A]`}>Our promises</p>
              <h2 id="principles-title" className="display mt-3 max-w-2xl text-[2rem] leading-tight !text-snow sm:text-[2.75rem]">
                Built to be checked, not just trusted.
              </h2>
              <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {PRINCIPLES.map((principle) => (
                  <li key={principle.title} className="rounded-2xl border border-snow/15 bg-snow/5 p-6">
                    <span aria-hidden="true" className={`${pixel.className} text-3xl text-[#86C45A]`}>
                      {principle.mark}
                    </span>
                    <h3 className="mt-3 text-xl font-semibold">{principle.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-snow/80">{principle.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="stack-title" className="bg-white">
            <div className={`page grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center ${styles.reveal}`}>
              <div>
                <p className={`${pixel.className} text-sm text-park`}>Under the hood</p>
                <h2 id="stack-title" className="display mt-3 text-[2rem] leading-tight sm:text-[2.75rem]">
                  One neighborhood app, two reading agents.
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                  The Next.js web app runs the feed, groups, news, map and votes, with sign-in through Amazon Cognito and data in
                  Aurora DSQL. Two Amazon Bedrock AgentCore runtimes built with Strands Agents do the reading: the pipeline agent
                  ingests public records and writes verified updates, and the chat agent answers residents&apos; questions with
                  citations from that same corpus. AWS credentials stay on the server.
                </p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {STACK.map((item) => (
                    <li key={item} className="rounded-full border border-rule bg-sky-mist px-3 py-1 font-mono text-sm text-ink">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-3 font-mono text-sm">
                {[
                  { name: "docket_web", body: "Feed → groups → news → places → votes", tone: "bg-white border-rule" },
                  { name: "docket_pipeline", body: "Fetch → extract → embed → verify → publish", tone: "bg-park-wash border-park/30" },
                  { name: "docket_chat", body: "Question → retrieve evidence → cited answer", tone: "bg-sky-mist border-sky-top" },
                ].map((runtime) => (
                  <div key={runtime.name} className={`rounded-2xl border p-5 ${runtime.tone}`}>
                    <p className="flex items-center gap-2 font-medium text-ink">
                      <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-park-leaf opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-park" />
                      </span>
                      {runtime.name}
                    </p>
                    <p className="mt-2 text-ink-soft">{runtime.body}</p>
                  </div>
                ))}
                <p className="px-1 text-ink-muted">
                  Evidence lives in Aurora DSQL, Amazon S3 and S3 Vectors. Photos and videos stay in a private S3 bucket.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="cta-title" className={`${styles.night} text-snow`}>
            <div className={`page pt-16 text-center sm:pt-24 ${styles.reveal}`}>
              <p className={`${pixel.className} text-sm text-[#EFF58A]`}>Good Neighbor Agents</p>
              <h2 id="cta-title" className="display mx-auto mt-3 max-w-2xl text-[2.25rem] leading-tight !text-snow sm:text-[3.25rem]">
                Your block, on the docket.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-snow/80">
                Find your neighborhood group, say hello in the feed, and let Docket keep watch while you sleep.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/#address" className="on-dark btn rounded-full bg-snow text-coal hover:bg-[#DDEBF6]">
                  Find your group
                </Link>
                <Link href="/groups" className="on-dark btn rounded-full border border-snow/60 text-snow hover:bg-snow/10">
                  Browse all groups
                </Link>
              </div>
            </div>
            <NightScene className="mt-10 aspect-[2/1] w-full sm:aspect-[3/1] lg:aspect-[4/1] lg:max-h-[26rem]" />
          </section>
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
