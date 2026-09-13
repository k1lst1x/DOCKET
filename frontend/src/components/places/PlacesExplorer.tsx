"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { pointInPolygon } from "@/lib/geo";
import {
  areaBySlug,
  CATEGORIES,
  categoryById,
  categoryForType,
  FREMONT,
  isOpenAt,
  neighborhoodAt,
  neighborhoodForGroups,
  NEIGHBORHOODS,
  type Area,
  type PlaceCategory,
} from "@/lib/places";
import { kmFromFremont } from "@/lib/live/parsers";
import { LIVE_KINDS, type LiveIncident, type LiveKind } from "@/lib/live/types";
import { LivePanel, livePin } from "./LivePanel";
import { useLiveIncidents } from "./useLiveIncidents";

// Live Google map of a Fremont neighborhood: its boundary highlighted, the places inside it
// from Google Places, filterable by category or a search, and every other neighborhood one
// click away. Results are cached in sessionStorage so flipping between filters doesn't re-query.

interface PlaceResult {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  typeLabel: string | null;
  primaryType: string | null;
  rating: number | null;
  ratingCount: number | null;
  mapsUrl: string | null;
  /** Neighborhood the place is in, or null when outside every Fremont neighborhood. */
  neighborhood: string | null;
}

interface PlaceDetail {
  id: string;
  failed: boolean;
  openNow?: boolean;
  closedTemporarily?: boolean;
  todayHours: string | null;
  phone: string | null;
  website: string | null;
  summary: string | null;
  photoUrl: string | null;
  photoCredit: { name: string; uri: string | null } | null;
}

type MapState = "loading" | "ready" | "missing-key" | "failed";
type SearchState = { status: "idle" | "loading" | "ready" | "error"; results: PlaceResult[]; error: string | null };

const AREA_KEY = "docket:places:area";
const CACHE_PREFIX = "docket:places:v1:";
const CACHE_MS = 30 * 60_000;
const MAX_QUERY = 80;
const LIST_FIELDS = [
  "id",
  "displayName",
  "location",
  "formattedAddress",
  "primaryType",
  "primaryTypeDisplayName",
  "rating",
  "userRatingCount",
  "googleMapsURI",
  "businessStatus",
];

const POLYGON_STYLES = {
  selected: { strokeColor: "#2F6A31", strokeOpacity: 1, strokeWeight: 3, fillColor: "#6DB33F", fillOpacity: 0.16, zIndex: 2 },
  city: { strokeColor: "#2F6A31", strokeOpacity: 0.55, strokeWeight: 1.5, fillColor: "#6DB33F", fillOpacity: 0.05, zIndex: 1 },
  other: { strokeColor: "#474747", strokeOpacity: 0.45, strokeWeight: 1, fillColor: "#8DC2F5", fillOpacity: 0.04, zIndex: 1 },
} satisfies Record<string, google.maps.PolygonOptions>;

function readCache(key: string): PlaceResult[] | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, results } = JSON.parse(raw) as { at: number; results: PlaceResult[] };
    return Date.now() - at < CACHE_MS ? results : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, results: PlaceResult[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), results }));
  } catch {
    // Storage full or blocked: searches just aren't cached.
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/PERMISSION_DENIED|not been used|is disabled|not authorized|API_KEY|REQUEST_DENIED|billing/i.test(message)) {
    return "Google Places turned this search down. The Places API (New) may not be enabled for this key.";
  }
  return "Google Places didn't respond. Try again in a moment.";
}

async function searchPlaces(area: Area, category: PlaceCategory, query: string): Promise<PlaceResult[]> {
  const { Place, SearchNearbyRankPreference } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  const { places } = query
    ? await Place.searchByText({ textQuery: query, fields: LIST_FIELDS, locationRestriction: area.bounds, maxResultCount: 20 })
    : await Place.searchNearby({
        fields: LIST_FIELDS,
        locationRestriction: { center: area.center, radius: area.radiusM },
        ...(category.types.length ? { includedTypes: category.types } : {}),
        maxResultCount: 20,
        rankPreference: SearchNearbyRankPreference.POPULARITY,
      });

  return places
    .filter((p) => p.location && String(p.businessStatus ?? "") !== "CLOSED_PERMANENTLY")
    .map((p) => {
      const lat = p.location!.lat();
      const lng = p.location!.lng();
      return {
        id: p.id,
        name: p.displayName ?? "Unnamed place",
        lat,
        lng,
        address: p.formattedAddress?.replace(/, USA$/, "") ?? null,
        typeLabel: p.primaryTypeDisplayName ?? null,
        primaryType: p.primaryType ?? null,
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        mapsUrl: p.googleMapsURI ?? null,
        neighborhood: neighborhoodAt(lng, lat)?.name ?? null,
      };
    });
}

async function loadDetail(id: string): Promise<PlaceDetail> {
  const { Place } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  const place = new Place({ id });
  await place.fetchFields({
    fields: ["businessStatus", "regularOpeningHours", "utcOffsetMinutes", "nationalPhoneNumber", "websiteURI", "photos", "editorialSummary"],
  });
  const closedTemporarily = String(place.businessStatus ?? "") === "CLOSED_TEMPORARILY";
  const openNow = closedTemporarily ? false : isOpenAt(place.regularOpeningHours?.periods, place.utcOffsetMinutes);
  // Google lists opening hours Monday first.
  const todayHours = place.regularOpeningHours?.weekdayDescriptions?.[(new Date().getDay() + 6) % 7] ?? null;
  const photo = place.photos?.[0];
  const credit = photo?.authorAttributions?.[0];
  return {
    id,
    failed: false,
    openNow,
    closedTemporarily,
    todayHours,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteURI ?? null,
    summary: place.editorialSummary ?? null,
    photoUrl: photo ? photo.getURI({ maxWidth: 640, maxHeight: 360 }) : null,
    photoCredit: credit ? { name: credit.displayName, uri: credit.uri ?? null } : null,
  };
}

function pinElement(result: PlaceResult, category: PlaceCategory, selected: boolean): HTMLElement {
  const icon = (categoryForType(result.primaryType) ?? category).icon;
  const color = (categoryForType(result.primaryType) ?? category).color;
  const pin = document.createElement("div");
  pin.textContent = icon === "⭐" ? "📍" : icon;
  Object.assign(pin.style, {
    display: "grid",
    placeItems: "center",
    width: selected ? "44px" : "34px",
    height: selected ? "44px" : "34px",
    fontSize: selected ? "22px" : "17px",
    lineHeight: "1",
    borderRadius: "9999px",
    background: selected ? "#262626" : "#ffffff",
    border: `3px solid ${selected ? "#ffffff" : color}`,
    boxShadow: selected ? "0 0 0 3px #262626, 0 6px 16px rgba(0,0,0,.35)" : "0 2px 6px rgba(0,0,0,.25)",
    transition: "width .15s, height .15s",
  });
  return pin;
}

const formatCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

export function PlacesExplorer({ apiKey, mapId }: { apiKey: string; mapId: string }) {
  const [areaSlug, setAreaSlug] = useState(FREMONT.slug);
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [insideOnly, setInsideOnly] = useState(true);
  const [homeSlug, setHomeSlug] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mapState, setMapState] = useState<MapState>(apiKey ? "loading" : "missing-key");
  const [mapError, setMapError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: "idle", results: [], error: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [tab, setTab] = useState<"places" | "live">("places");
  const [liveKinds, setLiveKinds] = useState<Set<LiveKind>>(() => new Set(LIVE_KINDS.map((k) => k.kind)));
  const [showLive, setShowLive] = useState(true);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const live = useLiveIncidents();

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polygonsRef = useRef(new Map<string, google.maps.Polygon>());
  const markersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const resultsRef = useRef<PlaceResult[]>([]);
  const liveMarkersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const liveIncidentsRef = useRef<LiveIncident[]>([]);

  const area = areaBySlug(areaSlug) ?? FREMONT;
  const category = categoryById(categoryId);
  const isCity = area.slug === FREMONT.slug;

  const visible = useMemo(() => {
    if (!insideOnly) return search.results;
    return search.results.filter((r) => (area.polygon ? pointInPolygon([r.lng, r.lat], area.polygon) : r.neighborhood !== null));
  }, [search.results, insideOnly, area]);
  const hiddenOutside = search.results.length - visible.length;
  resultsRef.current = visible;

  const liveIncidents = useMemo(() => (live.snapshot?.incidents ?? []).filter((i) => liveKinds.has(i.kind)), [live.snapshot, liveKinds]);
  liveIncidentsRef.current = liveIncidents;
  const liveCount = live.snapshot?.incidents.length ?? 0;
  const topAlert = live.snapshot?.alerts[0] ?? null;
  const moreAlerts = Math.max(0, (live.snapshot?.alerts.length ?? 0) - 1);

  // Starting area: the link, then the last one viewed here, then the member's home neighborhood.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(AREA_KEY);
    } catch {
      // Storage blocked: start from the link or the whole city.
    }
    const initial = [params.get("n"), stored].find((slug) => areaBySlug(slug));
    if (initial) setAreaSlug(initial);
    const c = params.get("c");
    if (c && CATEGORIES.some((x) => x.id === c)) setCategoryId(c);
    const q = params.get("q")?.trim().slice(0, MAX_QUERY);
    if (q) {
      setQuery(q);
      setDraft(q);
    }
    setHydrated(true);

    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { signedIn?: boolean; groups?: { slug: string }[] } | null) => {
        if (!active || !me?.signedIn) return;
        const home = neighborhoodForGroups((me.groups ?? []).map((g) => g.slug));
        if (!home) return;
        setHomeSlug(home.slug);
        if (!params.get("n")) setAreaSlug(home.slug);
      })
      .catch(() => {
        // The static preview has no API: browse without a home neighborhood.
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep the link shareable and remember the area for next time.
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const put = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
    put("n", isCity ? null : area.slug);
    put("c", query || categoryId === CATEGORIES[0].id ? null : categoryId);
    put("q", query || null);
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    try {
      window.localStorage.setItem(AREA_KEY, area.slug);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }, [hydrated, area, isCity, categoryId, query]);

  // Build the map and a clickable outline for every neighborhood.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];
    const polygons = polygonsRef.current;
    const markers = markersRef.current;
    const liveMarkers = liveMarkersRef.current;
    loadGoogleMaps(apiKey, () => {
      if (cancelled) return;
      setMapState("failed");
      setMapError("Google didn't accept this Maps API key. Check that the key allows this website and that billing is on.");
    })
      .then(async () => {
        const [{ Map }] = (await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("marker"),
          google.maps.importLibrary("places"),
        ])) as [google.maps.MapsLibrary, google.maps.MarkerLibrary, google.maps.PlacesLibrary];
        if (cancelled || !mapEl.current) return;
        const map = new Map(mapEl.current, {
          mapId,
          center: FREMONT.center,
          zoom: 12,
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "cooperative",
        });
        mapRef.current = map;
        for (const n of NEIGHBORHOODS) {
          const polygon = new google.maps.Polygon({
            map,
            paths: (n.polygon ?? []).map(([lng, lat]) => ({ lat, lng })),
            ...POLYGON_STYLES.other,
          });
          listeners.push(
            polygon.addListener("click", () => setAreaSlug(n.slug)),
            polygon.addListener("mouseover", () => setHovered(n.name)),
            polygon.addListener("mouseout", () => setHovered(null)),
          );
          polygons.set(n.slug, polygon);
        }
        setMapState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMapState("failed");
        setMapError(error instanceof Error ? error.message : "Google Maps couldn't load.");
      });
    return () => {
      cancelled = true;
      listeners.forEach((l) => l.remove());
      polygons.forEach((p) => p.setMap(null));
      polygons.clear();
      markers.forEach((m) => (m.map = null));
      markers.clear();
      liveMarkers.forEach((m) => (m.map = null));
      liveMarkers.clear();
      mapRef.current = null;
    };
  }, [apiKey, mapId]);

  // Highlight the chosen area and fit the map to it.
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== "ready" || !map) return;
    polygonsRef.current.forEach((polygon, slug) =>
      polygon.setOptions(slug === area.slug ? POLYGON_STYLES.selected : isCity ? POLYGON_STYLES.city : POLYGON_STYLES.other),
    );
    map.fitBounds(area.bounds, 32);
  }, [mapState, area, isCity]);

  // Search whenever the area, category or query changes.
  useEffect(() => {
    if (!hydrated || mapState !== "ready") return;
    let active = true;
    const key = `${CACHE_PREFIX}${area.slug}:${query ? `q:${query.toLowerCase()}` : `c:${category.id}`}`;
    setSelectedId(null);
    const cached = retryKey === 0 ? readCache(key) : null;
    if (cached) {
      setSearch({ status: "ready", results: cached, error: null });
      return;
    }
    setSearch((s) => ({ status: "loading", results: s.results, error: null }));
    searchPlaces(area, category, query)
      .then((results) => {
        if (!active) return;
        writeCache(key, results);
        setSearch({ status: "ready", results, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("[docket] places search failed", error);
        setSearch({ status: "error", results: [], error: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, [hydrated, mapState, area, category, query, retryKey]);

  // Draw a pin per visible place.
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== "ready" || !map) return;
    const markers = markersRef.current;
    const wanted = new Set(visible.map((r) => r.id));
    markers.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.map = null;
        markers.delete(id);
      }
    });
    for (const result of visible) {
      const selected = result.id === selectedId;
      const content = pinElement(result, category, selected);
      let marker = markers.get(result.id);
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: result.lat, lng: result.lng },
          title: result.name,
          content,
          gmpClickable: true,
        });
        marker.addEventListener("gmp-click", () => setSelectedId((current) => (current === result.id ? null : result.id)));
        markers.set(result.id, marker);
      } else {
        marker.content = content;
      }
      marker.zIndex = selected ? 1000 : null;
    }
  }, [mapState, visible, selectedId, category]);

  // Live incident pins, redrawn after every poll so new incidents appear and cleared ones disappear.
  useEffect(() => {
    const map = mapRef.current;
    if (mapState !== "ready" || !map) return;
    const markers = liveMarkersRef.current;
    const shown = showLive ? liveIncidents : [];
    const wanted = new Set(shown.map((i) => i.id));
    markers.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.map = null;
        markers.delete(id);
      }
    });
    const now = Date.now();
    for (const incident of shown) {
      const selected = incident.id === selectedIncidentId;
      const content = livePin(incident, selected, now);
      let marker = markers.get(incident.id);
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: incident.lat, lng: incident.lng },
          title: incident.subtitle ? `${incident.title}, ${incident.subtitle}` : incident.title,
          content,
          gmpClickable: true,
        });
        marker.addEventListener("gmp-click", () => {
          setTab("live");
          setSelectedIncidentId((current) => (current === incident.id ? null : incident.id));
        });
        markers.set(incident.id, marker);
      } else {
        marker.content = content;
        marker.position = { lat: incident.lat, lng: incident.lng };
      }
      marker.zIndex = selected ? 2000 : 500;
    }
  }, [mapState, liveIncidents, showLive, selectedIncidentId]);

  // Selecting an incident shows it on the map, zooming out for faraway quakes and fires.
  useEffect(() => {
    if (!selectedIncidentId) return;
    const map = mapRef.current;
    const incident = liveIncidentsRef.current.find((i) => i.id === selectedIncidentId);
    if (map && incident) {
      map.panTo({ lat: incident.lat, lng: incident.lng });
      if (kmFromFremont(incident.lat, incident.lng) > 25 && (map.getZoom() ?? 12) > 9) map.setZoom(9);
    }
    const timer = window.setTimeout(() => document.getElementById(`live-${selectedIncidentId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
  }, [selectedIncidentId]);

  // Selecting a place pans to it and loads hours, contact details and a photo.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const result = resultsRef.current.find((r) => r.id === selectedId);
    if (result) mapRef.current?.panTo({ lat: result.lat, lng: result.lng });
    document.getElementById(`place-${selectedId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    let active = true;
    setDetail(null);
    loadDetail(selectedId)
      .then((d) => active && setDetail(d))
      .catch(() => active && setDetail({ id: selectedId, failed: true, todayHours: null, phone: null, website: null, summary: null, photoUrl: null, photoCredit: null }));
    return () => {
      active = false;
    };
  }, [selectedId]);

  function chooseCategory(id: string) {
    setCategoryId(id);
    setQuery("");
    setDraft("");
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim().slice(0, MAX_QUERY));
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setNotice("This browser can't share your location.");
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const here = neighborhoodAt(position.coords.longitude, position.coords.latitude);
        if (here) {
          setAreaSlug(here.slug);
          setNotice(`You're in ${here.name}.`);
        } else {
          setNotice("Your location is outside Fremont's neighborhoods, so we kept the current area.");
        }
      },
      () => {
        setLocating(false);
        setNotice("We couldn't get your location. You can pick a neighborhood instead.");
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  const home = homeSlug ? areaBySlug(homeSlug) : undefined;
  const loading = search.status === "loading" || (mapState === "loading" && Boolean(apiKey));

  return (
    // Phones: controls, map, results in one scroll. Desktop: controls and results share a scrolling
    // column beside a full-height map.
    <div className="flex flex-1 flex-col bg-sky-mist lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      {/* relative: screen-reader-only text positions inside this scroller instead of stretching the page. */}
      <div className="contents lg:relative lg:col-start-1 lg:row-start-1 lg:block lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-rule">
      <section aria-labelledby="places-title" className="order-1 border-b border-rule bg-white px-4 pb-4 pt-5 sm:px-6">
        <p className="eyebrow">Places</p>
        <h1 id="places-title" className="display mt-1 text-[2rem] leading-tight sm:text-[2.25rem]">
          {isCity ? "Explore Fremont" : area.name}
        </h1>
        <p className="mt-1 text-base text-ink-soft">
          {isCity
            ? "Pick a neighborhood, or tap one on the map, to see what's there."
            : home?.slug === area.slug
              ? "Your neighborhood. Tap any other outline on the map to explore it."
              : "Tap another outline on the map, or pick one below, to explore it."}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="places-area" className="label text-sm">
              Neighborhood
            </label>
            <select id="places-area" value={area.slug} onChange={(e) => setAreaSlug(e.target.value)} className="field h-11 rounded-full pr-8">
              <option value={FREMONT.slug}>{FREMONT.name}</option>
              {home ? <option value={home.slug}>{`${home.name} (your neighborhood)`}</option> : null}
              <optgroup label="Neighborhoods">
                {NEIGHBORHOODS.filter((n) => n.slug !== home?.slug).map((n) => (
                  <option key={n.slug} value={n.slug}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <button type="button" onClick={locate} disabled={locating} className="btn btn-secondary h-11 rounded-full px-4 text-sm">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
              <circle cx="10" cy="10" r="3" fill="currentColor" />
              <path d="M10 2v3M10 15v3M2 10h3M15 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            {locating ? "Locating…" : "Near me"}
          </button>
        </div>
        {notice ? (
          <p role="status" className="mt-2 text-sm text-ink-soft">
            {notice}
          </p>
        ) : null}

        <form role="search" onSubmit={submitSearch} className="mt-3 flex items-center gap-2 rounded-full border border-field bg-white p-1 pl-4 focus-within:border-ink">
          <label htmlFor="places-query" className="sr-only">
            Search places in {area.name}
          </label>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id="places-query"
            type="search"
            value={draft}
            maxLength={MAX_QUERY}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value && query) setQuery("");
            }}
            placeholder={`Search ${isCity ? "Fremont" : area.name}: boba, dentist, tacos…`}
            className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button type="submit" className="btn btn-primary h-10 rounded-full px-4 text-sm" disabled={!draft.trim()}>
            Search
          </button>
        </form>

        <div role="group" aria-label="Filter by category" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {CATEGORIES.map((c) => {
            const active = !query && c.id === category.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => chooseCategory(c.id)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                  active ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40 hover:bg-sky-mist"
                }`}
              >
                <span aria-hidden="true">{c.icon}</span>
                {c.label}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Results" className="order-3 bg-sky-mist px-4 py-4 sm:px-6">
        <div role="group" aria-label="Show places or live incidents" className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-white p-1">
          {(
            [
              ["places", "Places", visible.length],
              ["live", "Live now", liveCount],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors ${
                tab === id ? "bg-ink text-white" : "text-ink hover:bg-sky-mist"
              }`}
            >
              {id === "live" ? <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live.status === "live" ? "bg-[#d93025]" : "bg-ink-muted"}`} /> : null}
              {label}
              <span className={`rounded-full px-1.5 font-mono text-xs ${tab === id ? "bg-white/20" : "bg-sky-mist"}`}>{n}</span>
            </button>
          ))}
        </div>
        {tab === "places" ? (
          <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm font-semibold text-ink">
            {search.status === "ready"
              ? `${visible.length} ${visible.length === 1 ? "place" : "places"} · ${query ? `“${query}”` : category.label}`
              : search.status === "loading"
                ? "Searching…"
                : ""}
          </p>
          {mapState === "ready" ? (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={insideOnly} onChange={(e) => setInsideOnly(e.target.checked)} className="h-4 w-4 accent-[#262626]" />
              Only inside {isCity ? "Fremont" : area.name}
            </label>
          ) : null}
        </div>
        {insideOnly && hiddenOutside > 0 && search.status === "ready" ? (
          <p className="mt-1 text-sm text-ink-muted">
            {hiddenOutside} more just outside the boundary.{" "}
            <button type="button" className="link" onClick={() => setInsideOnly(false)}>
              Show them
            </button>
          </p>
        ) : null}

        {search.status === "error" ? (
          <div role="alert" className="mt-3 rounded-2xl bg-signal-wash p-4 text-sm text-signal">
            <p className="font-semibold">{search.error}</p>
            <button type="button" className="btn btn-secondary mt-3 h-10 rounded-full px-4 text-sm" onClick={() => setRetryKey((k) => k + 1)}>
              Try again
            </button>
          </div>
        ) : null}

        {search.status === "ready" && visible.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-white p-4 text-base text-ink-soft">
            Nothing matched in {area.name}. Try another category, a different search, or a nearby neighborhood.
          </p>
        ) : null}

        {search.status === "loading" && visible.length === 0 ? (
          <ul aria-hidden="true" className="mt-3 grid gap-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-[4.5rem] animate-pulse rounded-2xl bg-white" />
            ))}
          </ul>
        ) : null}

        {visible.length ? (
          <ul className={`mt-3 grid gap-2 ${search.status === "loading" ? "opacity-60" : ""}`}>
            {visible.map((result) => {
              const selected = result.id === selectedId;
              const kind = categoryForType(result.primaryType) ?? category;
              return (
                <li key={result.id} className="min-w-0">
                  <button
                    id={`place-${result.id}`}
                    type="button"
                    aria-expanded={selected}
                    onClick={() => setSelectedId(selected ? null : result.id)}
                    className={`flex w-full min-w-0 items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                      selected ? "border-ink bg-white shadow-sm" : "border-transparent bg-white hover:border-ink/25"
                    }`}
                  >
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-mist text-lg" style={{ boxShadow: `inset 0 0 0 2px ${kind.color}` }}>
                      {kind.icon === "⭐" ? "📍" : kind.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug text-ink">{result.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {[result.typeLabel, isCity || result.neighborhood !== area.name ? result.neighborhood : null].filter(Boolean).join(" · ")}
                      </span>
                      {result.rating ? (
                        <span className="mt-0.5 block text-sm text-ink">
                          <span aria-hidden="true">
                            <span className="text-[#b45309]">★</span> {result.rating.toFixed(1)}
                            {result.ratingCount ? <span className="text-ink-muted"> ({formatCount(result.ratingCount)})</span> : null}
                          </span>
                          <span className="sr-only">
                            Rated {result.rating.toFixed(1)} out of 5{result.ratingCount ? ` from ${formatCount(result.ratingCount)} reviews` : ""}
                          </span>
                        </span>
                      ) : null}
                      {result.address ? <span className="mt-0.5 block truncate text-sm text-ink-soft">{result.address}</span> : null}
                    </span>
                  </button>
                  {selected ? <PlaceCard result={result} detail={detail?.id === result.id ? detail : null} /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {mapState === "ready" ? (
          <p className="mt-4 text-sm text-ink-muted">Places, ratings and hours from Google. Tap a place for details and directions.</p>
        ) : null}
          </>
        ) : (
          <LivePanel
            live={live}
            kinds={liveKinds}
            onToggleKind={(kind) =>
              setLiveKinds((current) => {
                const next = new Set(current);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                return next;
              })
            }
            showOnMap={showLive}
            onShowOnMap={setShowLive}
            selectedId={selectedIncidentId}
            onSelect={setSelectedIncidentId}
          />
        )}
      </section>
      </div>

      <div className="relative order-2 h-[55svh] min-h-[320px] lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-0">
        <div ref={mapEl} role="region" aria-label={`Map of places in ${area.name}`} className="absolute inset-0 bg-sky-haze" />
        {topAlert ? (
          <button
            type="button"
            onClick={() => setTab("live")}
            className={`absolute left-3 right-16 top-3 rounded-2xl px-4 py-2.5 text-left text-sm font-semibold shadow-lg ${
              topAlert.severity === "Extreme" || topAlert.severity === "Severe" ? "bg-signal text-white" : "bg-ochre-wash text-ochre"
            }`}
          >
            <span aria-hidden="true">⚠️ </span>
            {topAlert.event}
            {moreAlerts ? ` and ${moreAlerts} more ${moreAlerts === 1 ? "alert" : "alerts"}` : ""} for Fremont · <span className="underline">Details</span>
          </button>
        ) : null}
        {mapState === "ready" && hovered ? (
          <p aria-hidden="true" className={`pointer-events-none absolute left-3 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-ink shadow ${topAlert ? "top-[4.5rem]" : "top-3"}`}>
            {hovered}
          </p>
        ) : null}
        {loading && mapState !== "failed" ? (
          <p role="status" className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {mapState === "loading" ? "Loading the map…" : `Finding places in ${area.name}…`}
          </p>
        ) : null}
        {mapState === "missing-key" || mapState === "failed" ? <MapUnavailable state={mapState} error={mapError} /> : null}
      </div>
    </div>
  );
}

function PlaceCard({ result, detail }: { result: PlaceResult; detail: PlaceDetail | null }) {
  return (
    <div className="mx-1 -mt-2 rounded-b-2xl border border-t-0 border-ink bg-white px-3.5 pb-4 pt-4">
      {!detail ? (
        <p className="text-sm text-ink-muted">Loading details…</p>
      ) : (
        <>
          {detail.photoUrl ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- Google photo URLs are signed and short-lived. */}
              <img src={detail.photoUrl} alt={`Photo of ${result.name}`} className="aspect-[16/9] w-full rounded-xl object-cover" loading="lazy" />
              {detail.photoCredit ? (
                <figcaption className="mt-1 text-xs text-ink-muted">
                  Photo:{" "}
                  {detail.photoCredit.uri ? (
                    <a href={detail.photoCredit.uri} target="_blank" rel="noopener noreferrer" className="underline">
                      {detail.photoCredit.name}
                    </a>
                  ) : (
                    detail.photoCredit.name
                  )}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          {detail.summary ? <p className="mt-3 text-base text-ink">{detail.summary}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {detail.openNow !== undefined ? (
              <span className={`rounded-full px-2.5 py-0.5 font-semibold ${detail.openNow ? "bg-park-wash text-park" : "bg-signal-wash text-signal"}`}>
                {detail.closedTemporarily ? "Temporarily closed" : detail.openNow ? "Open now" : "Closed now"}
              </span>
            ) : null}
            {detail.todayHours ? <span className="text-ink-soft">{detail.todayHours}</span> : null}
          </div>
          {detail.failed ? <p className="mt-2 text-sm text-ink-muted">More details aren&apos;t available right now.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {result.mapsUrl ? (
              <a href={result.mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary h-10 rounded-full px-4 text-sm">
                Directions<span className="sr-only"> to {result.name} in Google Maps (opens in a new tab)</span>
              </a>
            ) : null}
            {detail.phone ? (
              <a href={`tel:${detail.phone.replace(/[^\d+]/g, "")}`} className="btn btn-secondary h-10 rounded-full px-4 text-sm">
                Call {detail.phone}
              </a>
            ) : null}
            {detail.website ? (
              <a href={detail.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary h-10 rounded-full px-4 text-sm">
                Website<span className="sr-only"> for {result.name} (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function MapUnavailable({ state, error }: { state: "missing-key" | "failed"; error: string | null }) {
  const dev = process.env.NODE_ENV !== "production";
  return (
    <div className="absolute inset-0 grid place-items-center bg-sky-haze p-6">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-lg font-semibold text-ink">{state === "missing-key" ? "The map isn't set up yet" : "The map couldn't load"}</p>
        <p className="mt-2 text-base text-ink-soft">
          {state === "missing-key" ? "Places will appear here once Google Maps is connected." : (error ?? "Try again in a moment.")}
        </p>
        {dev && state === "missing-key" ? (
          <p className="mt-3 rounded-xl bg-sky-mist p-3 text-left text-sm text-ink-soft">
            Add <code className="font-mono text-ink">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to <code className="font-mono text-ink">frontend/.env.local</code>, enable
            Maps JavaScript API and Places API (New) for the key, then restart the dev server.
          </p>
        ) : null}
      </div>
    </div>
  );
}
