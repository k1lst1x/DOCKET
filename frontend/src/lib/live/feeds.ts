import {
  FREMONT_CENTER,
  NEARBY_BOUNDS,
  parseBartAdvisories,
  parseCalFire,
  parseChpXml,
  parseCitySourced,
  parseClosures,
  parseNwsAlerts,
  parseOutages,
  parseUsgs,
  QUAKE_RADIUS_KM,
} from "./parsers";
import type { FeedId, LiveAlert, LiveIncident } from "./types";

// The public real-time feeds behind the Places live layer. Each has its own refresh interval,
// matched to how often the source itself updates. `browser` feeds allow cross-origin requests,
// so the static preview (no API routes) can still load them directly.

export interface FeedResult {
  incidents: LiveIncident[];
  alerts: LiveAlert[];
}

export interface Feed {
  id: FeedId;
  name: string;
  ttlMs: number;
  browser: boolean;
  load: (nowMs: number, options: { server: boolean }) => Promise<FeedResult>;
}

const TIMEOUT_MS = 12_000;
const USER_AGENT = `Docket/1.0 (Fremont neighborhood app; ${process.env.APP_URL ?? "https://github.com/k1lst1x/DOCKET"})`;

async function request(url: string, server: boolean, accept: string): Promise<Response> {
  const res = await fetch(url, {
    // Browsers set their own User-Agent; the weather service asks servers to identify themselves.
    headers: server ? { "User-Agent": USER_AGENT, Accept: accept } : { Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const incidentsOnly = (incidents: LiveIncident[]): FeedResult => ({ incidents, alerts: [] });

export const FEEDS: Feed[] = [
  {
    id: "chp",
    name: "CHP live incidents",
    ttlMs: 60_000,
    browser: false,
    load: async (_now, { server }) =>
      incidentsOnly(parseChpXml(await (await request("https://media.chp.ca.gov/sa_xml/sa.xml", server, "text/xml")).text())),
  },
  {
    id: "closures",
    name: "Caltrans lane closures",
    ttlMs: 5 * 60_000,
    browser: false,
    load: async (now, { server }) =>
      incidentsOnly(parseClosures(await (await request("https://cwwp2.dot.ca.gov/data/d4/lcs/lcsStatusD04.json", server, "application/json")).json(), now)),
  },
  {
    id: "quakes",
    name: "USGS earthquakes",
    ttlMs: 60_000,
    browser: true,
    load: async (now, { server }) => {
      const params = new URLSearchParams({
        format: "geojson",
        latitude: FREMONT_CENTER.lat.toFixed(4),
        longitude: FREMONT_CENTER.lng.toFixed(4),
        maxradiuskm: String(QUAKE_RADIUS_KM),
        starttime: new Date(now - 48 * 3600_000).toISOString().slice(0, 19),
        minmagnitude: "1",
        orderby: "time",
        limit: "100",
      });
      return incidentsOnly(parseUsgs(await (await request(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`, server, "application/json")).json()));
    },
  },
  {
    id: "fires",
    name: "CAL FIRE incidents",
    ttlMs: 5 * 60_000,
    browser: false,
    load: async (_now, { server }) =>
      incidentsOnly(parseCalFire(await (await request("https://www.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false", server, "application/json")).json())),
  },
  {
    id: "outages",
    name: "Power outages",
    ttlMs: 5 * 60_000,
    browser: true,
    load: async (_now, { server }) => {
      const { west, south, east, north } = NEARBY_BOUNDS;
      const params = new URLSearchParams({
        where: "1=1",
        geometry: `${west},${south},${east},${north}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "*",
        outSR: "4326",
        f: "geojson",
      });
      const url = `https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View)/FeatureServer/0/query?${params}`;
      return incidentsOnly(parseOutages(await (await request(url, server, "application/json")).json()));
    },
  },
  {
    id: "alerts",
    name: "Weather and disaster alerts",
    ttlMs: 60_000,
    browser: true,
    load: async (now, { server }) => ({
      incidents: [],
      // CAZ508 is Fremont's forecast and fire-weather zone; CAC001 is Alameda County.
      alerts: parseNwsAlerts(await (await request("https://api.weather.gov/alerts/active?zone=CAZ508,CAC001", server, "application/geo+json")).json(), now),
    }),
  },
  {
    id: "reports",
    name: "Fremont App resident reports",
    ttlMs: 5 * 60_000,
    // Needs the site's session cookie and CSRF token, which browsers can't read cross-origin.
    browser: false,
    load: async (now) => incidentsOnly(parseCitySourced(await loadCitySourced(), now)),
  },
  {
    id: "bart",
    name: "BART service advisories",
    ttlMs: 2 * 60_000,
    browser: false,
    load: async (now, { server }) =>
      // BART publishes this key for anyone to use with its public API.
      ({ incidents: [], alerts: parseBartAdvisories(await (await request("https://api.bart.gov/api/bsa.aspx?cmd=bsa&key=MW9S-E7SL-26DU-VV8V&json=y", server, "application/json")).json(), now) }),
  },
];

const CITYSOURCED = "https://fremontca.citysourced.com";

/** Cookie header from a response's Set-Cookie headers (name=value pairs only). */
function cookiesFrom(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[\w-]+=)/);
  return list
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

/**
 * Every service request the Fremont App (CitySourced) shows on its public "nearby" map. The map page
 * hands out a CSRF token and cookies, which the data endpoint requires. The response is citywide
 * (about 1,000 requests since 2020, ~1.6 MB), so the parser keeps only recent ones.
 */
async function loadCitySourced(): Promise<unknown> {
  const page = await fetch(`${CITYSOURCED}/servicerequests/nearby`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!page.ok) throw new Error(`HTTP ${page.status}`);
  const token = (await page.text()).match(/id="hdnCsrfToken"[^>]*?value="([^"]+)"/)?.[1];
  if (!token) throw new Error("No CSRF token");
  const body = new URLSearchParams({
    uniqueid: "docket-web",
    verb: "Post",
    endpoint: "D365Proxy",
    token,
    json: JSON.stringify({
      Path: "rst_oneviewcustomactions",
      AuthType: 2,
      HTTPVerb: "POST",
      Body: JSON.stringify({ Endpoint: "NEARBYREQUEST", XCoordinate: FREMONT_CENTER.lng.toFixed(4), YCoordinate: FREMONT_CENTER.lat.toFixed(4), IncludeAttachmentInfo: "false" }),
      IsCustomAction: true,
    }),
  });
  const res = await fetch(`${CITYSOURCED}/pages/ajax/callapiendpoint.ashx`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookiesFrom(page),
    },
    body,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { HasErrors?: boolean; Results?: unknown };
  if (json?.HasErrors || !Array.isArray(json?.Results)) throw new Error("Fremont App returned an error");
  return json;
}
