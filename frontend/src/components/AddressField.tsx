"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { FREMONT } from "@/lib/places";

// The home page address box, with Fremont street addresses suggested as you type (Google Places
// Autocomplete). Picking one finds your group straight away. Google loads on first focus, so visits
// that never touch the box cost nothing. Without a Maps key, or if Google is unreachable, it is a
// plain text box and the form works as before.

interface Suggestion {
  id: string;
  main: string;
  secondary: string | null;
  full: string;
}

const DEBOUNCE_MS = 180;
const MIN_CHARS = 3;
const MAX_SUGGESTIONS = 5;
const ADDRESS_TYPES = ["street_address", "premise", "subpremise", "route", "intersection"];

export function AddressField({ apiKey }: { apiKey: string }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [ready, setReady] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const request = useRef(0);
  const failed = useRef(false);
  const query = value.trim();

  function start() {
    if (!apiKey || ready || failed.current) return;
    loadGoogleMaps(apiKey, () => {
      failed.current = true;
      setReady(false);
    })
      .then(() => setReady(!failed.current))
      .catch(() => {
        failed.current = true;
      });
  }

  // Suggestions, debounced; responses to older keystrokes are ignored.
  useEffect(() => {
    if (!ready || query.length < MIN_CHARS) return;
    const id = ++request.current;
    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        token.current ??= new AutocompleteSessionToken();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: token.current,
          locationRestriction: FREMONT.bounds,
          origin: FREMONT.center,
          includedRegionCodes: ["us"],
          includedPrimaryTypes: ADDRESS_TYPES,
        });
        if (id !== request.current) return;
        setResults(
          suggestions
            .map((s) => s.placePrediction)
            .filter((p): p is google.maps.places.PlacePrediction => Boolean(p))
            .slice(0, MAX_SUGGESTIONS)
            .map((p) => ({
              id: p.placeId,
              main: p.mainText?.text ?? p.text.text,
              secondary: p.secondaryText?.text?.replace(/, USA$/, "") ?? null,
              full: p.text.text.replace(/, USA$/, ""),
            })),
        );
      } catch {
        if (id === request.current) setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, ready]);

  const items = query.length >= MIN_CHARS ? results : [];
  const expanded = open && items.length > 0;

  function choose(suggestion: Suggestion) {
    setValue(suggestion.full);
    setOpen(false);
    setActive(-1);
    token.current = null;
    const input = inputRef.current;
    if (!input) return;
    input.value = suggestion.full;
    input.form?.requestSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === "Enter" && expanded && active >= 0 && items[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="relative mt-3">
      <input
        ref={inputRef}
        id="address"
        name="address"
        type="text"
        required
        maxLength={200}
        role={apiKey ? "combobox" : undefined}
        aria-expanded={apiKey ? expanded : undefined}
        aria-controls={apiKey ? `${listId}-list` : undefined}
        aria-autocomplete={apiKey ? "list" : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete={apiKey ? "off" : "street-address"}
        placeholder="37600 Niles Blvd, Fremont"
        aria-describedby="address-hint"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          start();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="field h-12 rounded-full"
      />
      {expanded ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-2xl border border-rule bg-white p-1.5 shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 ${i === active ? "bg-sky-mist" : ""}`}
            >
              <span aria-hidden="true" className="mt-0.5 leading-none">
                📍
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{s.main}</span>
                {s.secondary ? <span className="block truncate text-sm text-ink-muted">{s.secondary}</span> : null}
              </span>
            </li>
          ))}
          <li aria-hidden="true" className="px-3 pb-1 pt-1.5 text-right text-xs text-ink-muted">
            Address suggestions by Google
          </li>
        </ul>
      ) : null}
    </div>
  );
}
