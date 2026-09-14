import { Pixelify_Sans } from "next/font/google";
import Link from "next/link";
import type { CSSProperties } from "react";
import { HeroFlock } from "@/components/pixel/HeroFlock";
import { NeighborhoodScene } from "@/components/pixel/NeighborhoodScene";
import { NightScene } from "@/components/pixel/NightScene";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { Sprite, vars } from "@/components/pixel/Sprite";
import { BLOCKS, ORES, blockUrl, layerEdge, type BlockTexture } from "@/components/pixel/textures";
import { DocketMark, SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { DepthMeter } from "./DepthMeter";
import styles from "./landing.module.css";
import { ScrollReveal } from "./ScrollReveal";
import { SplashText } from "./SplashText";

// The landing page (/) as a dig: the title screen on the surface, then one block layer per section
// (dirt, stone, deepslate, bedrock) down to a night-time surface at the end. Content slides,
// zooms or pops in as it scrolls into view (ScrollReveal), and the bar at the bottom tracks depth.
// The app itself starts at /app.

const pixel = Pixelify_Sans({ subsets: ["latin"], display: "swap", variable: "--font-pixel" });

const ROOT_ID = "landing-dig";

const { dirt, stone, deepslate, bedrock } = BLOCKS;

const TEXTURE_VARS = vars({
  "--tex-logo": blockUrl(stone),
  "--tex-button": blockUrl(stone, 0.45),
  "--tex-sign": blockUrl(BLOCKS.birch),
  "--tex-beam": blockUrl(BLOCKS.planks, 0.35),
  "--tex-dirt": blockUrl(dirt, 0.5),
  "--tex-stone": blockUrl(stone, 0.5),
  "--tex-mine": blockUrl(stone, 0.62),
  "--tex-deepslate": blockUrl(deepslate, 0.3),
  "--tex-deeper": blockUrl(deepslate, 0.48),
  "--tex-bedrock": blockUrl(bedrock),
});

/** Where one layer meets the next: blocks of the upper layer jut into the lower one. */
function edge(upper: [BlockTexture, number], lower: [BlockTexture, number], pattern: string): CSSProperties {
  return vars({ "--edge": layerEdge([...pattern].map((c) => (c === "u" ? upper : lower))), "--edge-blocks": String(pattern.length) });
}

const EDGE_STONE = edge([dirt, 0.5], [stone, 0.5], "ulluulllululllul");
const EDGE_MINE = edge([stone, 0.5], [stone, 0.62], "llulllluulllullu");
const EDGE_DEEPSLATE = edge([stone, 0.62], [deepslate, 0.3], "uullullluluulllu");
const EDGE_DEEPER = edge([deepslate, 0.3], [deepslate, 0.48], "lluluulllullulll");
const EDGE_BEDROCK = edge([deepslate, 0.48], [bedrock, 0], "ulluullullluulll");

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

const WITHOUT = [
  "Check city sites, news sites and alert feeds one by one",
  "Read long agenda packets to find one item",
  "Hear about it from a neighbor, after the fact",
];

const WITH = [
  "One feed for your neighbors and your neighborhood",
  "News, incidents and city hall, sorted for your area",
  "Plain summaries with sources, before the deadline",
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

const FEATURES: { icon: PixelIconName; id: string; href: string; title: string; body: string }[] = [
  {
    icon: "feed",
    id: "feed",
    href: "/app",
    title: "Neighborhood feed",
    body: "Post to your neighborhood or all of Fremont with photos, a short video, links and emoji. Reply, like and watch new posts arrive.",
  },
  {
    icon: "groups",
    id: "groups",
    href: "/groups",
    title: "Neighborhood groups",
    body: "Find your group by address, join with an email code, and follow what city hall has on the agenda for your area.",
  },
  {
    icon: "places",
    id: "places",
    href: "/places",
    title: "Places map",
    body: "Explore schools, parks, restaurants and more in any neighborhood, with photos, hours and ratings on Google Maps.",
  },
  {
    icon: "news",
    id: "news",
    href: "/news",
    title: "Fremont news",
    body: "Stories about city hall, police, fire, housing and traffic, filtered to Fremont and searchable by neighborhood, topic and source.",
  },
  {
    icon: "tells",
    id: "live_incidents",
    href: "/places",
    title: "Live incidents",
    body: "CHP calls, Caltrans lane closures, earthquakes, wildfires, weather alerts and power outages near Fremont, refreshed every minute.",
  },
  {
    icon: "votes",
    id: "votes",
    href: "/groups",
    title: "Community votes",
    body: "Take a stance on a local issue, read pros and cons that cite their sources, and review it for your neighbors.",
  },
  {
    icon: "chat",
    id: "ask_docket",
    href: "/chat",
    title: "Ask Docket",
    body: "Ask about Fremont's public records in plain language and get answers with numbered sources. It knows which page or story you have open.",
  },
  {
    icon: "reads",
    id: "city_hall",
    href: "/groups",
    title: "City hall, read for you",
    body: "An AI agent works through council and planning agendas, minutes, school board meetings and state bills, and turns them into short, cited updates.",
  },
  {
    icon: "checks",
    id: "safe_to_share",
    href: "/app",
    title: "Safe to share",
    body: "Posts, reviews, names, photos and videos are checked for abuse, including disguised words and disguised files, before neighbors see them.",
  },
];

const PROMISES: { ore: keyof typeof ORES; title: string; body: string }[] = [
  {
    ore: "diamond",
    title: "Every claim links to the record",
    body: "Agent summaries and answers cite the agenda, minutes or report they came from, and a fact that isn't in its source gets removed. Docket points you to the public record; it doesn't replace it.",
  },
  {
    ore: "emerald",
    title: "Neighbors' votes are opinions",
    body: "Community polls show how residents feel. They are never presented as official council votes.",
  },
  {
    ore: "redstone",
    title: "Checked before neighbors see it",
    body: "Words, photos and videos go through automatic checks first. If a file can't be checked, it isn't shown.",
  },
  {
    ore: "gold",
    title: "Sample data says so",
    body: "Groups, agenda items, posts and votes that aren't live yet are clearly marked as sample data.",
  },
];

const STATIONS = [
  { title: "Crawl", body: "Reads the source registry, honors robots.txt and waits between requests to each site." },
  { title: "Ingest", body: "Pulls out the text, splits it into chunks and embeds them with Titan Text Embeddings V2." },
  { title: "Research", body: "Hybrid search: S3 Vectors plus BM25 keyword search, fused into one ranked list." },
  { title: "Write", body: "A summarizer and a deliberator draft updates that cite their evidence by number." },
  { title: "Verify", body: "A model checks every claim, and code requires hard facts to appear word for word." },
  { title: "Publish", body: "Only claims that pass both checks reach your neighborhood." },
];

const RUNTIMES = [
  { name: "docket_web", body: "Feed → groups → news → places → votes", color: "#E08A2E" },
  { name: "docket_pipeline", body: "Fetch → extract → embed → verify → publish", color: "#5FAE4B" },
  { name: "docket_chat", body: "Question → retrieve evidence → cited answer", color: "#8E5CC9" },
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

const CHAT_LOG = [
  { who: "Neighbor", text: "Which site did the City Council rezone from Regional Commercial to Tech Industrial in July 2026?" },
  {
    who: "Docket",
    text: "The City Council rezoned the 11.21-acre site at 43800 Osgood Road from Regional Commercial (C-R) to Tech Industrial (I-T) in July 2026 [1].",
  },
  { who: "Neighbor", text: "What is the population of Fremont, California?" },
  { who: "Docket", text: "I don't have anything in my sources about that." },
];

const ADVANCEMENTS: { icon: PixelIconName; title: string; score: number; of: number }[] = [
  { icon: "reads", title: "Retrieval hit rate", score: 20, of: 20 },
  { icon: "chat", title: "Answered", score: 19, of: 20 },
  { icon: "checks", title: "Citation validity", score: 19, of: 20 },
  { icon: "news", title: "Cited the expected evidence", score: 18, of: 20 },
  { icon: "barrier", title: "Correct refusals", score: 5, of: 5 },
];

function reveal(kind: "up" | "down" | "left" | "right" | "zoom" | "place" | "flip", delayMs = 0) {
  return { "data-reveal": kind, style: vars({ "--delay": `${delayMs}ms` }) };
}

function Block({ texture, className }: { texture: BlockTexture; className?: string }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false" shapeRendering="crispEdges" className={className}>
      <Sprite rows={texture.rows} palette={texture.palette} />
    </svg>
  );
}

const ARROW = ["......a....", "......aa...", "......aaa..", "aaaaaaaaaa.", "aaaaaaaaaaa", "aaaaaaaaaa.", "......aaa..", "......aa...", "......a...."];

function SectionIntro({ id, depth, eyebrow, title, children, center = false }: { id: string; depth: number; eyebrow: string; title: string; children?: React.ReactNode; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className={styles.eyebrow} {...reveal("left")}>
        <span className={styles.eyebrowDepth}>Y {depth}</span> {eyebrow}
      </p>
      <h2 id={id} className={`${styles.heading} mt-3`} {...reveal("up", 80)}>
        {title}
      </h2>
      {children ? (
        <div className={`${styles.lead} mt-5`} {...reveal("up", 160)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function LandingPage() {
  return (
    <>
      <div id={ROOT_ID} className={`${pixel.variable} ${styles.root}`} style={TEXTURE_VARS}>
        <ScrollReveal rootId={ROOT_ID} />
        <DepthMeter />

        <div className={`bg-sky-top ${styles.sky}`}>
          <SiteHeader tone="sky" />
          <main id="main">
            {/* Clipped sideways only, so birds can leave through the edges and rise above the hero. */}
            <div className="relative overflow-x-clip">
              <HeroFlock />
              <section aria-labelledby="landing-title" className="page relative pt-8 text-center sm:pt-14">
                <div className={styles.logoWrap}>
                  <p aria-hidden="true" className={styles.logo}>
                    DOCKET
                  </p>
                  <p aria-hidden="true" className={styles.edition}>
                    Neighborhood Edition
                  </p>
                  <span className={styles.splashTilt}>
                    <SplashText className={styles.splash} />
                  </span>
                </div>

                <h1 id="landing-title" className={`${styles.heroTitle} ${styles.enter}`} style={vars({ "--delay": "350ms" })}>
                  <span className="sr-only">Docket: </span>
                  Your whole neighborhood, in one place.
                </h1>
                <p className={`mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl ${styles.enter}`} style={vars({ "--delay": "450ms" })}>
                  Docket is where Fremont neighbors talk, catch local news and live incidents, explore places nearby and weigh in on what
                  city hall is deciding. Its AI agent reads the public record for you and cites every source.
                </p>

                <nav aria-label="Get started" className={styles.menu}>
                  <Link href="/app" className={`${styles.button} ${styles.buttonGreen} ${styles.menuWide} ${styles.enter}`} style={vars({ "--delay": "550ms" })}>
                    Open Docket
                  </Link>
                  <Link href="/app#address" className={`${styles.button} ${styles.menuWide} ${styles.enter}`} style={vars({ "--delay": "620ms" })}>
                    Find your group
                  </Link>
                  <Link href="/chat" className={`${styles.button} ${styles.enter}`} style={vars({ "--delay": "690ms" })}>
                    Ask Docket
                  </Link>
                  <Link href="/news" className={`${styles.button} ${styles.enter}`} style={vars({ "--delay": "760ms" })}>
                    Fremont news
                  </Link>
                </nav>

                <a href="#why-title" className={`${styles.digHint} ${styles.enter}`} style={vars({ "--delay": "900ms" })}>
                  <PixelIcon name="pickaxe" className={`h-6 w-6 ${styles.pickaxe}`} />
                  Scroll to dig in
                </a>
              </section>

              <NeighborhoodScene className="mt-6 aspect-[5/4] w-full sm:mt-8 sm:aspect-[2/1] lg:aspect-[3/1] lg:max-h-[34rem]" />
            </div>

            {/* ---------- Dirt: the problem ---------- */}
            <section aria-labelledby="why-title" className={`${styles.layer} ${styles.dirt}`}>
              <div className="page grid gap-10 py-16 sm:py-24 lg:grid-cols-2 lg:items-center">
                <SectionIntro id="why-title" depth={56} eyebrow="The problem" title="Keeping up with your own street shouldn't be a part-time job.">
                  <p>
                    City decisions hide in agenda packets and meeting minutes. Road closures, fires and outages sit on state and federal
                    feeds. Local stories are spread across several news sites, and neighbors talk in group chats and forums. By the time it
                    all adds up, the meeting is over and the chance to speak has passed.
                  </p>
                </SectionIntro>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className={styles.gui} {...reveal("left", 120)}>
                    <h3 className={styles.guiTitle}>Without Docket</h3>
                    <ul className="mt-4 grid gap-3">
                      {WITHOUT.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span className={styles.slotMini}>
                            <PixelIcon name="barrier" className="h-6 w-6" />
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.gui} {...reveal("right", 240)}>
                    <h3 className={styles.guiTitle}>With Docket</h3>
                    <ul className="mt-4 grid gap-3">
                      {WITH.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span className={styles.slotMini}>
                            <PixelIcon name="tick" className="h-6 w-6" />
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* ---------- Stone: how it works, as a crafting recipe ---------- */}
            <section aria-labelledby="how-title" className={`${styles.layer} ${styles.stone} ${styles.edge}`} style={EDGE_STONE}>
              <div className="page py-16 sm:py-24">
                <SectionIntro id="how-title" depth={32} eyebrow="How it works" title="Neighbors talk. Docket keeps watch." center />

                <div className={`${styles.gui} ${styles.crafting}`} {...reveal("zoom", 100)}>
                  <p aria-hidden="true" className={styles.guiTitle}>
                    Crafting
                  </p>
                  <div aria-hidden="true" className={styles.recipe}>
                    <div className={styles.recipeInputs}>
                      {STEPS.map((step, i) => (
                        <span key={step.title} className={`${styles.slot} ${styles.recipeSlot}`} {...reveal("place", 350 + i * 180)}>
                          <PixelIcon name={step.icon} className="h-8 w-8 sm:h-10 sm:w-10" />
                          <span className={styles.slotCount}>{i + 1}</span>
                        </span>
                      ))}
                    </div>
                    <svg viewBox="0 0 11 9" shapeRendering="crispEdges" className={styles.arrow} {...reveal("up", 0)}>
                      <Sprite rows={ARROW} palette={{ a: "#8B8B8B" }} />
                      <Sprite rows={ARROW} palette={{ a: "#FFFFFF" }} className={styles.arrowFill} />
                    </svg>
                    <span className={`${styles.slot} ${styles.recipeOutput}`} {...reveal("place", 1900)}>
                      <DocketMark className="h-12 w-12 sm:h-16 sm:w-16" />
                    </span>
                  </div>
                  <p className={styles.recipeCaption}>
                    Your block + Docket keeping watch + neighbors weighing in = <strong>a neighborhood that knows first</strong>
                  </p>
                </div>

                <ol className="mt-10 grid gap-5 md:grid-cols-3">
                  {STEPS.map((step, i) => (
                    <li key={step.title} className={`${styles.guiDark} p-6`} {...reveal("up", i * 140)}>
                      <div className="flex items-center gap-4">
                        <span className={`${styles.slot} h-14 w-14 shrink-0`}>
                          <PixelIcon name={step.icon} className="h-9 w-9" />
                          <span className={styles.slotCount}>{i + 1}</span>
                        </span>
                        <h3 className={styles.cardTitle}>{step.title}</h3>
                      </div>
                      <p className="mt-4 text-base leading-relaxed text-[#D8D8D8]">{step.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {/* ---------- Mineshaft: features as an inventory ---------- */}
            <section aria-labelledby="features-title" className={`${styles.layer} ${styles.mine} ${styles.edge}`} style={EDGE_MINE}>
              <div className="page py-16 sm:py-24">
                <SectionIntro id="features-title" depth={8} eyebrow="Your inventory" title="Talk, explore, stay informed and speak up.">
                  <p>Nine slots, one neighborhood. Every item opens a part of Docket.</p>
                </SectionIntro>
                <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {FEATURES.map((feature, i) => (
                    <li key={feature.title} {...reveal("zoom", (i % 3) * 110)}>
                      <Link href={feature.href} className={`${styles.tooltip} ${styles.item}`}>
                        <span className={`${styles.slot} h-16 w-16 shrink-0`}>
                          <PixelIcon name={feature.icon} className={`h-10 w-10 ${styles.itemIcon}`} />
                        </span>
                        <span className="min-w-0">
                          <span className={styles.itemTitle}>{feature.title}</span>
                          <span className={styles.itemId}>docket:{feature.id}</span>
                          <span className="mt-2 block text-base leading-relaxed text-[#CFCFCF]">{feature.body}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ---------- Deepslate: promises, one ore each ---------- */}
            <section aria-labelledby="promises-title" className={`${styles.layer} ${styles.deepslate} ${styles.edge}`} style={EDGE_DEEPSLATE}>
              <div className="page py-16 sm:py-24">
                <SectionIntro id="promises-title" depth={-16} eyebrow="Our promises" title="Built to be checked, not just trusted." />
                <ul className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                  {PROMISES.map((promise, i) => (
                    <li key={promise.title} className={`${styles.guiDark} p-6`} {...reveal("flip", i * 120)}>
                      <span className={styles.oreFrame} {...reveal("place", 250 + i * 120)}>
                        <Block texture={ORES[promise.ore]} className="h-14 w-14" />
                      </span>
                      <h3 className={`${styles.cardTitle} mt-5`}>{promise.title}</h3>
                      <p className="mt-2 text-base leading-relaxed text-[#D8D8D8]">{promise.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ---------- Deeper: the reading agent as a minecart line ---------- */}
            <section aria-labelledby="stack-title" className={`${styles.layer} ${styles.deeper} ${styles.edge}`} style={EDGE_DEEPER}>
              <div className="page py-16 sm:py-24">
                <SectionIntro id="stack-title" depth={-36} eyebrow="Under the hood" title="One neighborhood app, two reading agents.">
                  <p>
                    The Next.js web app runs the feed, groups, news, map and votes, with sign-in through Amazon Cognito and data in Aurora
                    DSQL. Two Amazon Bedrock AgentCore runtimes built with Strands Agents do the reading: the pipeline agent ingests public
                    records and writes verified updates, and the chat agent answers residents&apos; questions with citations from that same
                    corpus. AWS credentials stay on the server.
                  </p>
                </SectionIntro>

                <h3 className={`${styles.cardTitle} mt-12`} {...reveal("left")}>
                  Every record rides the line
                </h3>
                <div className={styles.railway}>
                  <ol className={styles.stations}>
                    {STATIONS.map((station, i) => (
                      <li key={station.title} className={styles.sign} {...reveal("down", i * 110)}>
                        <span className={styles.signStep}>{i + 1}</span>
                        <span className={styles.signTitle}>{station.title}</span>
                        <span className="mt-1 block text-base leading-snug text-coal">{station.body}</span>
                      </li>
                    ))}
                  </ol>
                  <div aria-hidden="true" className={styles.rail}>
                    <span className={styles.cart}>
                      <PixelIcon name="minecart" className="h-full w-full" />
                    </span>
                  </div>
                </div>

                <div className="mt-12 grid gap-4 lg:grid-cols-3">
                  {RUNTIMES.map((runtime, i) => (
                    <div key={runtime.name} className={`${styles.guiDark} p-5 font-mono`} {...reveal("right", i * 120)}>
                      <p className="flex items-center gap-3 font-medium text-snow">
                        <span aria-hidden="true" className={styles.commandBlock} style={vars({ "--block-color": runtime.color })} />
                        {runtime.name}
                      </p>
                      <p className="mt-2 text-sm text-[#CFCFCF]">{runtime.body}</p>
                    </div>
                  ))}
                </div>
                <ul className="mt-6 flex flex-wrap gap-2" aria-label="Built with">
                  {STACK.map((item, i) => (
                    <li key={item} className={styles.chip} {...reveal("place", i * 60)}>
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-base text-[#BDBDBD]" {...reveal("up")}>
                  Evidence lives in Aurora DSQL, Amazon S3 and S3 Vectors. Photos and videos stay in a private S3 bucket.
                </p>
              </div>
            </section>

            {/* ---------- Deeper still: evals as advancements ---------- */}
            <section aria-labelledby="evals-title" className={`${styles.layer} ${styles.deeper}`}>
              <div className="page grid gap-10 pb-16 sm:pb-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
                <div>
                  <SectionIntro id="evals-title" depth={-52} eyebrow="Evals" title="Tested before it talks.">
                    <p>
                      A groundedness suite asks 20 questions about real Fremont records, plus 5 the records can&apos;t answer. Docket has
                      to cite its sources on the first kind and say so on the second.
                    </p>
                  </SectionIntro>
                  <ol className={styles.chat} aria-label="Sample answers from the eval run">
                    {CHAT_LOG.map((line, i) => (
                      <li key={line.text} className={styles.chatLine} {...reveal("left", i * 160)}>
                        <span className={line.who === "Docket" ? styles.chatDocket : styles.chatNeighbor}>&lt;{line.who}&gt;</span> {line.text}
                      </li>
                    ))}
                  </ol>
                </div>
                <ul className="grid gap-3 lg:pt-10" aria-label="Eval results">
                  {ADVANCEMENTS.map((a, i) => (
                    <li key={a.title} className={styles.toast} {...reveal("right", i * 130)}>
                      <PixelIcon name={a.icon} className="h-10 w-10 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className={styles.toastTitle}>Advancement made!</span>
                        <span className="block text-base text-snow">{a.title}</span>
                        <span aria-hidden="true" className={styles.toastBar}>
                          <span style={{ width: `${(a.score / a.of) * 100}%` }} />
                        </span>
                      </span>
                      <span className={styles.toastScore}>
                        {a.score}/{a.of}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ---------- Bedrock: everything Docket reads ---------- */}
            <section aria-labelledby="sources-title" className={`${styles.layer} ${styles.bedrock} ${styles.edge}`} style={EDGE_BEDROCK}>
              <div className="page pb-8 pt-12 sm:pt-16">
                <p id="sources-title" className={styles.eyebrow} {...reveal("up")}>
                  <span className={styles.eyebrowDepth}>Y -60</span> Bedrock: what Docket reads
                </p>
              </div>
              <div className={`${styles.marqueeWrap} overflow-hidden pb-12 text-snow`}>
                <p className="sr-only">Docket keeps up with: {SOURCES.join(", ")}.</p>
                <div aria-hidden="true" className={styles.marquee}>
                  {[0, 1].map((copy) => (
                    <ul key={copy} className="flex shrink-0 items-center">
                      {SOURCES.map((source) => (
                        <li key={source} className={styles.marqueeItem}>
                          {source}
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            </section>

            {/* ---------- Back on the surface, at night ---------- */}
            <section aria-labelledby="cta-title" className={`${styles.night} text-snow`}>
              <div className="page pt-16 text-center sm:pt-24">
                <p className={styles.eyebrow} {...reveal("down")}>
                  Good Neighbor Agents
                </p>
                <h2 id="cta-title" className={`${styles.heading} mx-auto mt-3 max-w-2xl`} {...reveal("zoom", 100)}>
                  Your block, on the docket.
                </h2>
                <p className={`${styles.lead} mx-auto mt-4 max-w-xl`} {...reveal("up", 200)}>
                  Find your neighborhood group, say hello in the feed, and let Docket keep watch while you sleep.
                </p>
                <div className="mx-auto mt-8 grid max-w-md gap-3 sm:grid-cols-2">
                  <Link href="/app" className={`${styles.button} ${styles.buttonGreen}`} {...reveal("left", 300)}>
                    Open Docket
                  </Link>
                  <Link href="/groups" className={styles.button} {...reveal("right", 380)}>
                    Browse all groups
                  </Link>
                </div>
              </div>
              <NightScene className="mt-10 aspect-[2/1] w-full sm:aspect-[3/1] lg:aspect-[4/1] lg:max-h-[26rem]" />
            </section>
          </main>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
