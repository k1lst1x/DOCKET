import type { NewsCategory } from "./types";

// Pure helpers for neighborhood news: RSS/Atom parsing, topic classification and place matching.

export interface RawEntry {
  id: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  snippet: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Feed text to plain text: CDATA unwrapped, HTML (often escaped twice) removed, whitespace collapsed. */
export function toText(html: string): string {
  const unwrapped = decodeEntities(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const TAGS = {
  title: /<title\b[^>]*>([\s\S]*?)<\/title>/,
  link: /<link\b[^>]*>([\s\S]*?)<\/link>/,
  linkHref: /<link\b[^>]*href="([^"]+)"/,
  pubDate: /<pubDate>([\s\S]*?)<\/pubDate>/,
  published: /<published>([\s\S]*?)<\/published>/,
  updated: /<updated>([\s\S]*?)<\/updated>/,
  description: /<description\b[^>]*>([\s\S]*?)<\/description>/,
  content: /<content\b[^>]*>([\s\S]*?)<\/content>/,
  source: /<source\b[^>]*>([\s\S]*?)<\/source>/,
  guid: /<guid\b[^>]*>([\s\S]*?)<\/guid>/,
  id: /<id>([\s\S]*?)<\/id>/,
};

const pick = (block: string, pattern: RegExp) => block.match(pattern)?.[1] ?? null;
const httpUrl = (value: string | null) => {
  const url = value ? toText(value) : "";
  return /^https?:\/\//i.test(url) ? url : null;
};
const isoDate = (value: string | null) => {
  if (!value) return null;
  const t = Date.parse(toText(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// Cards clamp to three lines; the story popup shows the whole summary.
const SNIPPET_MAX = 700;

export function parseFeed(xml: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const block = match[2];
    let title = toText(pick(block, TAGS.title) ?? "");
    const url = httpUrl(pick(block, TAGS.link)) ?? httpUrl(pick(block, TAGS.linkHref));
    if (!title || !url) continue;
    const sourceTag = pick(block, TAGS.source);
    const source = sourceTag ? toText(sourceTag) || null : null;
    // Google News titles end with " - Publisher".
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();

    const rawSnippet = pick(block, TAGS.description) ?? pick(block, TAGS.content);
    let snippet = rawSnippet
      ? toText(rawSnippet)
          .replace(/submitted by\s+\/u\/\S+.*$/i, "")
          .replace(/\[(link|comments)\]/gi, "")
          .trim()
      : "";
    // Google News descriptions only repeat the headline and publisher.
    if (snippet && (snippet.toLowerCase().startsWith(title.toLowerCase()) || (source && snippet === source))) snippet = "";
    if (snippet.length > SNIPPET_MAX) snippet = `${snippet.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;

    entries.push({
      id: toText(pick(block, TAGS.guid) ?? pick(block, TAGS.id) ?? url),
      title,
      url,
      source,
      publishedAt: isoDate(pick(block, TAGS.pubDate) ?? pick(block, TAGS.published) ?? pick(block, TAGS.updated)),
      snippet: snippet || null,
    });
  }
  return entries;
}

// ------------------------------------------------------------------------------------------------
// Topics

const CATEGORY_RULES: [NewsCategory, RegExp][] = [
  [
    "safety",
    /\b(police|crimes?|criminal|arrest(ed|s)?|shootings?|shots?|stabb(ed|ing)|robber(y|ies)|burglar(y|ies)|theft|stolen|homicide|murder(ed)?|assault(ed)?|suspects?|riots?|protest(s|ers)?|vandal(ism|ized)?|carjack(ing|ed)?|scams?|missing person)\b/i,
  ],
  [
    "disaster",
    /\b(fires?|blaze|wildfires?|firefighters?|earthquakes?|quake|flood(s|ing)?|evacuat(e|ed|ion|ions)|storms?|power outages?|outages?|hazmat|red flag|heat wave|tsunami|disasters?|smoke|air quality)\b/i,
  ],
  ["cityhall", /\b(city council|council|planning commission|ordinances?|mayor|city hall|school board|elections?|ballot|measure [a-z]{1,2}|budget|fusd|unified school district|supervisors?)\b/i],
  // A crash or closure is traffic news even near new homes; a BART mention alone isn't.
  ["traffic", /\b(crash(es)?|collisions?|closures?|hit-and-run|pedestrians? (struck|killed|hit)|detours?|shut down)\b/i],
  [
    "housing",
    /\b(housing|homes|home (sales?|prices?|values?)|apartments?|real estate|realtors?|listings?|for sale|escrow|rents?|rentals?|condos?|townhomes?|developments?|developers?|zoning|homeless(ness)?|mortgages?|unit \d+)\b/i,
  ],
  ["traffic", /\b(traffic|bart|highway|freeway|i-880|i-680|interstate|pedestrians?|lanes)\b/i],
];

export function classifyNews(text: string): NewsCategory {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return "community";
}

// ------------------------------------------------------------------------------------------------
// Places

/**
 * Names people use for each of Fremont's 32 neighborhoods (the Docket groups), including landmarks
 * inside it. Names that are ordinary words or shared with other places ("Downtown", "Northgate",
 * "Mission Valley") only count when tied to Fremont; landmarks are ones mapped inside the
 * neighborhood's boundary. The first three also build that neighborhood's Google News search.
 */
export const DISTRICT_ALIASES: Record<string, string[]> = {
  "28 Palms": ["28 Palms neighborhood", "Fremont's 28 Palms", "28 Palms, Fremont"],
  Ardenwood: ["Ardenwood", "Ardenwood Historic Farm"],
  "Ardenwood Technology Park": ["Ardenwood Technology Park", "Ardenwood Tech Park"],
  "Bayside Technology Park": ["Bayside Technology Park", "Bayside Tech Park"],
  // Blacow Road and Blacow Elementary are in neighboring areas (28 Palms, South Sundale).
  Blacow: ["Blacow neighborhood", "Fremont's Blacow", "Blacow, Fremont"],
  Brookvale: ["Brookvale Elementary", "Brookvale neighborhood", "Brookvale, Fremont"],
  Cabrillo: ["Cabrillo Elementary", "Fremont's Cabrillo", "Cabrillo, Fremont"],
  "Cameron Hills": ["Cameron Hills"],
  // Vallejo Mill Historical Park itself is in Niles, so only the plural neighborhood name counts here.
  "Canyon Heights/Vallejo Mills/Niles Crest": ["Canyon Heights", "Vallejo Mills", "Niles Crest"],
  Centerville: ["Centerville"],
  "Cherry/Guardino": ["Cherry/Guardino", "Cherry-Guardino", "Cherry Guardino"],
  // "Fremont hub" alone is often a company's new office.
  "City Center": ["Fremont City Center", "Lake Elizabeth", "Fremont Hub shopping center"],
  Downtown: ["Downtown Fremont", "Fremont's downtown", "Fremont Downtown Event Center"],
  Glenmoor: ["Glenmoor Elementary", "Glenmoor neighborhood", "Glenmoor, Fremont"],
  Grimmer: ["Grimmer Elementary", "Grimmer neighborhood", "Grimmer, Fremont"],
  "Innovation District": ["Fremont Innovation District", "Tesla's Fremont factory", "Tesla Fremont factory", "Fremont's Innovation District"],
  Irvington: ["Irvington", "Five Corners"],
  "Kimber/Gomes": ["Kimber/Gomes", "Gomes Elementary", "Kimber-Gomes"],
  "Lakes and Birds": ["Lakes and Birds neighborhood", "Lakes & Birds", "Lakes and Birds, Fremont"],
  "Mission Hills": ["Fremont's Mission Hills", "Mission Hills, Fremont", "Mission Hills in Fremont"],
  "Mission San Jose": ["Mission San Jose", "Mission Peak", "Ohlone College"],
  "Mission Valley": ["Mission Valley Elementary", "Fremont's Mission Valley", "Mission Valley, Fremont"],
  Niles: ["Niles", "Niles Canyon", "Niles Boulevard", "Niles Blvd"],
  Northgate: ["Fremont's Northgate", "Northgate, Fremont", "Northgate in Fremont"],
  "Pacific Commons/Auto Mall": ["Pacific Commons", "Fremont Auto Mall"],
  Parkmont: ["Parkmont"],
  "South Sundale": ["South Sundale"],
  Sundale: ["Sundale neighborhood", "Fremont's Sundale", "Sundale, Fremont"],
  "Vineyards/Avalon": ["Vineyards/Avalon", "Vineyards-Avalon", "Vineyards Avalon"],
  "Warm Springs": ["Warm Springs"],
  "Warm Springs Technology Park": ["Warm Springs Technology Park", "Warm Springs Tech Park"],
  Weibel: ["Weibel Elementary", "Weibel neighborhood", "Weibel, Fremont"],
};

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function containsWord(haystack: string, needle: string): boolean {
  for (let from = 0; ; ) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = haystack[i - 1] ?? " ";
    const after = haystack[i + needle.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = i + 1;
  }
}

export function mentionsNeighborhood(text: string, district: string): boolean {
  const haystack = fold(text);
  return (DISTRICT_ALIASES[district] ?? [district]).some((alias) => containsWord(haystack, fold(alias)));
}

/** Fremont itself, or places that only exist in Fremont (bare "Niles" or "Centerville" could be anywhere). */
const FREMONT_NAMES = [
  "fremont",
  "mission san jose",
  "ardenwood",
  "pacific commons",
  "mission peak",
  "lake elizabeth",
  "coyote hills",
  "ohlone college",
  "niles canyon",
  "warm springs bart",
  "irvington bart",
  "fusd",
];
export const mentionsFremontArea = (text: string) => {
  const haystack = fold(text);
  return FREMONT_NAMES.some((name) => containsWord(haystack, name));
};

/** Bay Area outlets whose stories naming a Fremont neighborhood are about Fremont. */
const LOCAL_SOURCES = [
  "tri city voice",
  "tri-city voice",
  "patch",
  "east bay times",
  "mercury news",
  "sfgate",
  "san francisco chronicle",
  "kron4",
  "ktvu",
  "abc7",
  "nbc bay area",
  "kqed",
  "kpix",
  "cbs san francisco",
  "cbs news bay area",
  "bay city news",
  "caltrans",
  "california department of transportation",
  "city of fremont",
  "fremont police",
  "pleasanton weekly",
  "the oaklandside",
  "sfist",
  "fremont unified",
];
export const isLocalSource = (source: string | null) => {
  const name = fold(source ?? "");
  return Boolean(name) && LOCAL_SOURCES.some((local) => name.includes(local));
};

/** Paid press releases, law-firm ads written to look like news, sports schedule pages, and obituary listings. */
const PROMOTIONAL_SOURCES =
  /(openpr|financialcontent|einpresswire|ein presswire|accesswire|newswire|press release|attorneys?|law (group|firm|offices?)|\blaw\b|injury lawyers?|lawyers?|maxpreps|dignity memorial|legacy\.com|echovita|tributearchive|everloved|forevermissed|obituar(y|ies)|funeral homes?|mortuary|memorial chapel)/i;
export const isPromotional = (source: string | null, title: string) =>
  PROMOTIONAL_SOURCES.test(source ?? "") || /\b(top|best) [a-z ]*realtor|named #1|passes \d+ client reviews|\bobituar(y|ies)\b/i.test(title);

/** Other places that share a Fremont neighborhood's name. */
const ELSEWHERE: Record<string, RegExp> = {
  Niles: /\b(ohio|michigan|illinois|mich|ill|youngstown|trumbull|mahoning|wfmj|niles (north|west|township))\b/i,
  Irvington: /\b(new jersey|n\.?j|new york|n\.?y|virginia|indianapolis|kentucky|alabama|nebraska)\b/i,
  Centerville: /\b(ohio|utah|iowa|georgia|texas|tennessee|massachusetts|minnesota|maryland|virginia|indiana|south dakota|pennsylvania|cape cod)\b/i,
  "Warm Springs": /\b(oregon|georgia|virginia|nevada|arkansas|montana|reservation|confederated tribes)\b/i,
  "Mission San Jose": /\b(texas|san antonio)\b/i,
  Brookvale: /\b(australia|sydney|new south wales|nsw)\b/i,
  Cabrillo: /\b(pacifica|aptos|santa cruz|cabrillo college|san diego|santa clara|half moon bay|lompoc|oxnard|san pedro)\b/i,
  "Cameron Hills": /\b(alberta|canada|northwest territories)\b/i,
  "Canyon Heights/Vallejo Mills/Niles Crest": /\b(utah|arizona|new mexico|texas|colorado|idaho|washington state)\b/i,
  Glenmoor: /\b(ohio|canton|florida|missouri)\b/i,
  "Mission Hills": /\b(los angeles|san fernando|kansas|rancho mirage|san diego)\b/i,
  "Mission Valley": /\b(san diego|kansas|texas)\b/i,
  Northgate: /\b(seattle|berkeley|san rafael|walnut creek|northgate (mall|high))\b/i,
  Parkmont: /\b(washington,? d\.?c\.?|d\.c\.)/i,
  Sundale: /\b(bakersfield|tasmania)\b/i,
  "South Sundale": /\b(bakersfield|tasmania)\b/i,
};

/** Stories about the other Fremonts (Nebraska, Ohio, Seattle's Fremont neighborhood…). */
const OTHER_FREMONTS =
  /\bfremont,?\s+(neb|nebraska|ohio|oh|mich|michigan|ind|indiana|wis|wisconsin|n\.?\s?c|north carolina|wyo?|wyoming|n\.?\s?h|new hampshire|iowa|mo|missouri)\b|fremont tribune|news-messenger|advertiser-tribune|fremont county|fremont street experience|seattle'?s fremont|fremont, seattle|fremont bridge|wnax|kfor/i;
export const aboutAnotherFremont = (text: string) => OTHER_FREMONTS.test(text);

/** About another Fremont, or another town sharing this neighborhood's name (Niles, Ohio). */
export const aboutElsewhere = (text: string, district: string) => aboutAnotherFremont(text) || (ELSEWHERE[district]?.test(text) ?? false);

/** The Docket neighborhoods a story names, ignoring same-name places elsewhere (Niles, Ohio). */
export function neighborhoodsMentioned(text: string): string[] {
  return Object.keys(DISTRICT_ALIASES).filter((district) => mentionsNeighborhood(text, district) && !(ELSEWHERE[district]?.test(text) ?? false));
}

/** Headlines differ in punctuation and case across outlets; compare on letters and digits. */
export const titleKey = (title: string) => fold(title).replace(/[^a-z0-9]+/g, " ").trim();
