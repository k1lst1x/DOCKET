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
    "Docket is a civic reading agent for Fremont, California. It reads city hall agendas, minutes and staff reports, and tells each neighborhood what changed, with sources.",
};

const SOURCES = [
  "City Council agendas",
  "Planning Commission minutes",
  "Staff reports",
  "Adopted ordinances",
  "Fremont city news",
  "Caltrans road work",
  "CHP incidents",
  "USGS earthquakes",
  "CAL FIRE",
  "National Weather Service alerts",
  "Power outages",
];

const STEPS: { icon: PixelIconName; title: string; body: string }[] = [
  {
    icon: "reads",
    title: "Reads",
    body: "The pipeline agent watches public Fremont records in the background: agendas, minutes, staff reports and city news. It respects robots.txt and keeps the original documents.",
  },
  {
    icon: "checks",
    title: "Checks",
    body: "Long packets become short updates, but every claim is checked against the retrieved evidence first. Anything that can't be backed up doesn't get published.",
  },
  {
    icon: "tells",
    title: "Tells your block",
    body: "Updates reach the neighborhood they affect, with a link to the source, what it means locally and how long you have to weigh in.",
  },
];

const FEATURES: { icon: PixelIconName; href: string; title: string; body: string }[] = [
  { icon: "feed", href: "/", title: "Neighborhood feed", body: "Post, reply and like with neighbors in any Fremont neighborhood." },
  { icon: "groups", href: "/groups", title: "Neighborhood groups", body: "Join your group and see what it's watching at city hall." },
  { icon: "places", href: "/places", title: "Places map", body: "Schools, parks and food, plus civic issues and live incidents." },
  { icon: "news", href: "/news", title: "Fremont news", body: "Police, fire, traffic and city hall news in one searchable page." },
  { icon: "chat", href: "/chat", title: "Ask Docket", body: "Ask about city documents in plain language. Answers come with numbered sources." },
  { icon: "votes", href: "/groups", title: "Community votes", body: "Say how you feel about an issue and read neighbors' reviews and pros and cons." },
];

const PRINCIPLES = [
  {
    title: "Every claim links to the record",
    body: "Summaries cite the agenda, minutes or staff report they came from. Docket is a guide to the public record, never a substitute for it.",
  },
  {
    title: "Neighbors' votes are opinions",
    body: "Community polls show how residents feel. They are never presented as official council votes.",
  },
  {
    title: "Sample data says so",
    body: "Groups, agenda items and votes that the live agent hasn't read yet are clearly marked as sample data.",
  },
];

const STACK = [
  "Strands Agents",
  "Amazon Bedrock AgentCore",
  "Aurora DSQL",
  "Amazon S3 Vectors",
  "Amazon Cognito",
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
              City hall, read for your neighborhood.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              Docket is a civic reading agent. It works through Fremont agendas, minutes and staff reports, then tells your block
              what changed, why it matters, and when you can still speak up.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/#address" className="btn btn-primary rounded-full">
                Find your group
              </Link>
              <Link href="/chat" className="btn btn-secondary rounded-full border-ink/30 bg-white/70">
                Ask Docket a question
              </Link>
            </div>
          </section>

          <NeighborhoodScene className="mt-8 aspect-[5/4] w-full sm:mt-10 sm:aspect-[2/1] lg:aspect-[3/1] lg:max-h-[34rem]" />
          </div>

          <div className={`${styles.bedrock} ${styles.marqueeWrap} overflow-hidden py-4 text-white`}>
            <p className="sr-only">Docket reads: {SOURCES.join(", ")}.</p>
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
                  City decisions are public. Following them is a part-time job.
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                  To learn whether a decision touches your street, you have to dig through agendas, meeting minutes, staff reports and
                  city news spread across several sites. By the time it makes sense, the chance to respond has often passed.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-rule bg-sky-mist p-6">
                  <p className="eyebrow">Without Docket</p>
                  <ul className="mt-4 grid gap-3 text-base text-ink-soft">
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Search several city sites every week
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Read long agenda packets to find one item
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-signal" />
                      Hear about it after the meeting
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-park/30 bg-park-wash p-6">
                  <p className="eyebrow text-park">With Docket</p>
                  <ul className="mt-4 grid gap-3 text-base text-ink">
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      One update for the blocks it affects
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      A plain summary with a link to the source
                    </li>
                    <li className="flex gap-3">
                      <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 bg-park" />
                      Time to speak up before the deadline
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
                A quiet agent that does the reading.
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
                    Everything happening on your block, in one place.
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

          <section aria-labelledby="principles-title" className="bg-park-deep text-white">
            <div className={`page py-16 sm:py-24 ${styles.reveal}`}>
              <p className={`${pixel.className} text-sm text-park-leaf`}>Our promises</p>
              <h2 id="principles-title" className="display mt-3 max-w-2xl text-[2rem] leading-tight !text-white sm:text-[2.75rem]">
                Built to be checked, not just trusted.
              </h2>
              <ul className="mt-10 grid gap-4 md:grid-cols-3">
                {PRINCIPLES.map((principle, i) => (
                  <li key={principle.title} className="rounded-2xl border border-white/15 bg-white/5 p-6">
                    <span aria-hidden="true" className={`${pixel.className} text-3xl text-park-leaf`}>
                      {["§", "✓", "#"][i]}
                    </span>
                    <h3 className="mt-3 text-xl font-semibold">{principle.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-white/80">{principle.body}</p>
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
                  Two agents, one source of truth.
                </h2>
                <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                  Docket runs on two Amazon Bedrock AgentCore runtimes built with Strands Agents. The pipeline agent ingests public
                  records, stores the evidence and writes verified updates. The chat agent answers residents&apos; questions with
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
                <p className="px-1 text-ink-muted">Evidence lives in Aurora DSQL, Amazon S3 and S3 Vectors.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="cta-title" className={`${styles.night} text-white`}>
            <div className={`page pt-16 text-center sm:pt-24 ${styles.reveal}`}>
              <p className={`${pixel.className} text-sm text-[#EFF58A]`}>Good Neighbor Agents</p>
              <h2 id="cta-title" className="display mx-auto mt-3 max-w-2xl text-[2.25rem] leading-tight !text-white sm:text-[3.25rem]">
                Your block, on the docket.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-white/80">
                Find your neighborhood group and let Docket keep watch while you sleep.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/#address" className="on-dark btn rounded-full bg-white text-ink hover:bg-sky-haze">
                  Find your group
                </Link>
                <Link href="/groups" className="on-dark btn rounded-full border border-white/60 text-white hover:bg-white/10">
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
