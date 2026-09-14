"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The active theme, kept in sync with <html data-theme>. The server always renders light. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }, []);
  return { theme, setTheme };
}
