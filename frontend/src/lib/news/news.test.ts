import { describe, expect, it } from "vitest";
import type { LiveIncident } from "../live/types";
import type { LngLat } from "../types";
import { incidentNearBoundary } from "./near";
import {
  aboutAnotherFremont,
  aboutElsewhere,
  classifyNews,
  decodeEntities,
  isLocalSource,
  isPromotional,
  mentionsFremontArea,
  mentionsNeighborhood,
  parseFeed,
  titleKey,
  toText,
} from "./parse";

const GOOGLE = `<rss><channel><title>"Irvington" Fremont - Google News</title>
<item><title>Irvington BART station construction starts next month - The Mercury News</title><link>https://news.google.com/rss/articles/CBMiabc?oc=5</link><guid isPermaLink="false">CBMiabc</guid><pubDate>Mon, 07 Sep 2026 13:06:23 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMiabc?oc=5" target="_blank"&gt;Irvington BART station construction starts next month&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Mercury News&lt;/font&gt;</description><source url="https://www.mercurynews.com">The Mercury News</source></item>
<item><title>No link here</title></item>
</channel></rss>`;

const TRI_CITY_VOICE = `<rss><channel><item>
    <title>Sixty year old deceased after traffic collision</title>
    <link>https://tricityvoice.com/sixty-year-old-deceased-after-traffic-collision/</link>
    <pubDate>Wed, 09 Sep 2026 19:59:35 +0000</pubDate>
    <guid isPermaLink="false">https://tricityvoice.com/?p=48280</guid>
    <description><![CDATA[<div style="line-height: 1.6;">On Monday, Sept. 7 at approximately 4:15am, Fremont Police officers responded to a collision on Stevenson Boulevard.&#160; First responders arrived at [&#8230;]</div>]]></description>
</item></channel></rss>`;

const REDDIT = `<feed><entry><author><name>/u/someone</name></author><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Loud booms near Niles Canyon tonight, anyone know what that was? &lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/someone&quot;&gt; /u/someone &lt;/a&gt; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/Fremont/comments/1/booms/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content><id>t3_1wfe4gn</id><link href="https://www.reddit.com/r/Fremont/comments/1/booms/" /><updated>2026-09-13T17:36:30+00:00</updated><published>2026-09-13T17:36:30+00:00</published><title>Booms near Niles?</title></entry></feed>`;

describe("parseFeed", () => {
  it("reads Google News items, splitting off the publisher and dropping headline-only descriptions", () => {
    const [item, ...rest] = parseFeed(GOOGLE);
    expect(rest).toHaveLength(0);
    expect(item).toEqual({
      id: "CBMiabc",
      title: "Irvington BART station construction starts next month",
      url: "https://news.google.com/rss/articles/CBMiabc?oc=5",
      source: "The Mercury News",
      publishedAt: "2026-09-07T13:06:23.000Z",
      snippet: null,
    });
  });

  it("reads WordPress RSS with CDATA and entities", () => {
    const [item] = parseFeed(TRI_CITY_VOICE);
    expect(item.title).toBe("Sixty year old deceased after traffic collision");
    expect(item.snippet).toBe("On Monday, Sept. 7 at approximately 4:15am, Fremont Police officers responded to a collision on Stevenson Boulevard. First responders arrived at […]");
    expect(item.publishedAt).toBe("2026-09-09T19:59:35.000Z");
  });

  it("reads Reddit Atom entries without the submitted-by boilerplate", () => {
    const [item] = parseFeed(REDDIT);
    expect(item).toMatchObject({ id: "t3_1wfe4gn", title: "Booms near Niles?", url: "https://www.reddit.com/r/Fremont/comments/1/booms/", source: null });
    expect(item.snippet).toBe("Loud booms near Niles Canyon tonight, anyone know what that was?");
  });

  it("ignores links that aren't http(s)", () => {
    expect(parseFeed("<rss><item><title>Bad</title><link>javascript:alert(1)</link></item></rss>")).toEqual([]);
  });

  it("decodes entities and strips markup", () => {
    expect(decodeEntities("Tom &amp; Jerry &#8217;s &#x2014; &nbsp;")).toBe("Tom & Jerry ’s — " + " ");
    expect(toText("&lt;b&gt;Bold&lt;/b&gt; <i>move</i>")).toBe("Bold move");
  });
});

describe("classifyNews", () => {
  it.each([
    ["Fremont police arrest suspect in Irvington burglary spree", "safety"],
    ["Protesters gather outside Fremont City Hall", "safety"],
    ["Grass fire forces evacuations near Mission Peak", "disaster"],
    ["Magnitude 3.1 earthquake shakes Fremont", "disaster"],
    ["I-880 in Fremont shut down by crash early Monday morning", "traffic"],
    ["Six-story apartments approved near Irvington BART", "housing"],
    ["City Council adopts short-term rental ordinance", "cityhall"],
    ["Niles holds Antique Faire & Flea Market", "community"],
    ["Crash closes Mission Boulevard near new townhomes", "traffic"],
    ["Fremont Boulevard traffic study starts", "traffic"],
    ["How much were the 10 most expensive home sales in Fremont?", "housing"],
    ["44762 Old Warm Springs Blvd Unit 203, Fremont, CA 94538", "housing"],
  ])("%s → %s", (title, category) => expect(classifyNews(title)).toBe(category));
});

describe("place matching", () => {
  it("matches neighborhood names and landmarks as whole words", () => {
    expect(mentionsNeighborhood("Weekend closure of Niles Boulevard", "Niles")).toBe(true);
    expect(mentionsNeighborhood("Hikers rescued on Mission Peak", "Mission San Jose")).toBe(true);
    expect(mentionsNeighborhood("Mission San José parade", "Mission San Jose")).toBe(true);
    expect(mentionsNeighborhood("Along the Nile river", "Niles")).toBe(false);
    expect(mentionsNeighborhood("Warm Springs BART plaza opens", "Warm Springs")).toBe(true);
    expect(mentionsNeighborhood("Warm springs weather", "Irvington")).toBe(false);
  });

  it("recognizes the Fremont area and screens out other Fremonts", () => {
    expect(mentionsFremontArea("I-880 in Fremont shut down by crash")).toBe(true);
    expect(mentionsFremontArea("Ardenwood Historic Farm reopens its barn")).toBe(true);
    expect(mentionsFremontArea("Teen boy suffers injuries in Union City crash")).toBe(false);
    expect(mentionsFremontArea("Fire near BART Coliseum station causes major delay")).toBe(false);
    expect(aboutElsewhere("10 Niles students achieve perfect scores on their Ohio State Tests", "Niles")).toBe(true);
    expect(aboutElsewhere("Niles holds Antique Faire & Flea Market", "Niles")).toBe(false);
    expect(aboutElsewhere("Warm Springs tribes open new clinic in Oregon", "Warm Springs")).toBe(true);
    expect(isLocalSource("Tri City Voice")).toBe(true);
    expect(isLocalSource("East Bay Times")).toBe(true);
    expect(isLocalSource("wfmj.com")).toBe(false);
    expect(isLocalSource(null)).toBe(false);
  });

  it("screens out press releases and law-firm ads, but not reporting about lawsuits", () => {
    expect(isPromotional("openPR.com", "Top Fremont Realtor Named #1 Real Estate Team")).toBe(true);
    expect(isPromotional("Pacific Attorney Group", "Pedestrian Killed in Fremont Crash")).toBe(true);
    expect(isPromotional("Arash Law", "60-Year-Old Pedestrian Killed in Fremont")).toBe(true);
    expect(isPromotional("The Mercury News", "Fremont sued over housing element")).toBe(false);
    expect(isPromotional("SFGATE", "Fremont: 81-Year-Old Man Dies After Falling From E-Bike")).toBe(false);
    expect(aboutAnotherFremont("Fremont, Nebraska man arrested")).toBe(true);
    expect(aboutAnotherFremont("Fremont Tribune: county fair results")).toBe(true);
    expect(aboutAnotherFremont("Fremont police arrest suspect")).toBe(false);
  });

  it("dedupes headlines across outlets by letters and digits", () => {
    expect(titleKey("I-880 in Fremont: Shut down by crash!")).toBe(titleKey("I 880 in Fremont shut down by crash"));
  });
});

describe("incidentNearBoundary", () => {
  const square: LngLat[] = [
    [-121.99, 37.57],
    [-121.97, 37.57],
    [-121.97, 37.59],
    [-121.99, 37.59],
  ];
  const incident = (kind: LiveIncident["kind"], lat: number, lng: number, magnitude: number | null = null): LiveIncident => ({
    id: `${kind}-${lat}`,
    kind,
    title: kind,
    subtitle: null,
    severity: "minor",
    lat,
    lng,
    startedAt: null,
    updatedAt: null,
    endsAt: null,
    magnitude,
    sourceName: "Test",
    sourceUrl: null,
  });

  it("keeps road incidents within 2 km, fires within 80 km and felt or close quakes", () => {
    expect(incidentNearBoundary(incident("traffic", 37.58, -121.98), square)).toBe(true);
    expect(incidentNearBoundary(incident("traffic", 37.53, -121.98), square)).toBe(false);
    expect(incidentNearBoundary(incident("fire", 37.2, -121.7), square)).toBe(true);
    expect(incidentNearBoundary(incident("quake", 37.87, -121.8, 2.6), square)).toBe(false);
    expect(incidentNearBoundary(incident("quake", 37.87, -121.8, 3.8), square)).toBe(true);
  });
});
