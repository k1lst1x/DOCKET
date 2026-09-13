"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { IssueMarker } from "@/lib/issue-types";
import { NEARBY_BOUNDS } from "@/lib/live/parsers";
import { CATEGORIES, NEIGHBORHOODS, type Area } from "@/lib/places";

// Search box with suggestions as you type: neighborhoods, place categories and city issues
// instantly, then real addresses and businesses from Google Places Autocomplete near Fremont.

export type SearchPick =
  | { kind: "area"; slug: string }
  | { kind: "category"; id: string }
  | { kind: "issue"; id: string }
  | { kind: "place"; prediction: google.maps.places.PlacePrediction }
  | { kind: "query"; text: string };

interface Suggestion {
  key: string;
  icon: string;
  label: string;
  detail: string | null;
  tag: string;
  pick: SearchPick;
}

const DEBOUNCE_MS = 220;
const MAX_GOOGLE = 5;

interface PlaceSearchProps {
  area: Area;
  value: string;
  onChange: (value: string) => void;
  onPick: (pick: SearchPick) => void;
  issues: IssueMarker[];
  googleReady: boolean;
  maxLength: number;
}

export function PlaceSearch({ area, value, onChange, onPick, issues, googleReady, maxLength }: PlaceSearchProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [google, setGoogle] = useState<{ query: string; items: Suggestion[] }>({ query: "", items: [] });
  const [googleError, setGoogleError] = useState(false);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const request = useRef(0);
  const query = value.trim();
  const areaName = area.slug === "fremont" ? "Fremont" : area.name;

  const local = useMemo<Suggestion[]>(() => {
    const q = query.toLowerCase();
    if (q.length < 2) return [];
    const areas = NEIGHBORHOODS.filter((n) => n.name.toLowerCase().includes(q))
      .slice(0, 3)
      .map((n) => ({ key: `area-${n.slug}`, icon: "📍", label: n.name, detail: "Fremont neighborhood", tag: "Neighborhood", pick: { kind: "area", slug: n.slug } as SearchPick }));
    const categories = CATEGORIES.filter((c) => c.types.length && c.label.toLowerCase().includes(q))
      .slice(0, 2)
      .map((c) => ({ key: `cat-${c.id}`, icon: c.icon, label: c.label, detail: `In ${areaName}`, tag: "Category", pick: { kind: "category", id: c.id } as SearchPick }));
    const matchingIssues = issues
      .filter((i) => i.title.toLowerCase().includes(q) || i.location.label.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q))
      .slice(0, 3)
      .map((i) => ({ key: `issue-${i.id}`, icon: "🗳️", label: i.title, detail: i.location.label || null, tag: "City issue", pick: { kind: "issue", id: i.id } as SearchPick }));
    return [...areas, ...categories, ...matchingIssues];
  }, [query, issues, areaName]);

  // Google suggestions, debounced; stale responses are ignored.
  useEffect(() => {
    if (!googleReady || query.length < 2) return;
    const id = ++request.current;
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = (await window.google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        token.current ??= new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: token.current,
          locationRestriction: NEARBY_BOUNDS,
          origin: area.center,
          includedRegionCodes: ["us"],
        });
        if (id !== request.current) return;
        const items = suggestions
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => Boolean(p))
          // Nearest first, so "Safeway" offers the Fremont store before one in Santa Clara.
          .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
          .slice(0, MAX_GOOGLE)
          .map((p) => ({
            key: `place-${p.placeId}`,
            icon: p.types.some((t) => /route|street_address|premise|subpremise|postal_code|locality/.test(t)) ? "🏠" : "🏪",
            label: p.mainText?.text ?? p.text.text,
            detail: [p.secondaryText?.text?.replace(/, USA$/, ""), p.distanceMeters ? `${(p.distanceMeters / 1000).toFixed(1)} km away` : null].filter(Boolean).join(" · ") || null,
            tag: "Place",
            pick: { kind: "place", prediction: p } as SearchPick,
          }));
        setGoogle({ query, items });
        setGoogleError(false);
      } catch {
        if (id === request.current) setGoogleError(true);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, googleReady, area.center]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (query.length < 2) return [];
    const fromGoogle = google.query === query ? google.items : [];
    return [
      ...local,
      ...fromGoogle,
      { key: "query", icon: "🔍", label: `Search ${areaName} for “${query}”`, detail: null, tag: "Search", pick: { kind: "query", text: query } },
    ];
  }, [local, google, query, areaName]);

  const expanded = open && suggestions.length > 0;

  function choose(suggestion: Suggestion) {
    setOpen(false);
    setActive(-1);
    if (suggestion.pick.kind === "place") token.current = null; // the session ends when a place is fetched
    onPick(suggestion.pick);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (expanded && active >= 0 && suggestions[active]) choose(suggestions[active]);
    else if (query) choose({ key: "query", icon: "", label: "", detail: null, tag: "", pick: { kind: "query", text: query } });
  }

  return (
    <div className="relative mt-3">
      <form role="search" onSubmit={onSubmit} className="flex items-center gap-2 rounded-full border border-field bg-white p-1 pl-4 focus-within:border-ink">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search places, addresses and issues in {areaName}
        </label>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted">
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-opt-${active}` : undefined}
          autoComplete="off"
          value={value}
          maxLength={maxLength}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={`Search ${areaName}: an address, boba, dentist…`}
          className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-muted focus:outline-none"
        />
        <button type="submit" className="btn btn-primary h-10 rounded-full px-4 text-sm" disabled={!query}>
          Search
        </button>
      </form>
      {expanded ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[22rem] overflow-y-auto rounded-2xl border border-rule bg-white p-1.5 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
              className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-sky-mist" : ""}`}
            >
              <span aria-hidden="true" className="mt-0.5 text-lg leading-none">
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{s.label}</span>
                {s.detail ? <span className="block truncate text-sm text-ink-muted">{s.detail}</span> : null}
              </span>
              <span className="shrink-0 rounded-full bg-sky-mist px-2 py-0.5 text-xs text-ink-soft">{s.tag}</span>
            </li>
          ))}
          {googleError ? <li className="px-3 py-2 text-sm text-ink-muted">Address suggestions aren&apos;t available right now.</li> : null}
          {google.items.length ? <li className="px-3 pb-1 pt-2 text-right text-xs text-ink-muted">Place suggestions by Google</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
