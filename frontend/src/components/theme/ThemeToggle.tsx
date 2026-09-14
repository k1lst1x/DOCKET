"use client";

import { useEffect } from "react";
import { Sprite } from "@/components/pixel/Sprite";
import { useTheme } from "@/components/theme/useTheme";
import { THEME_KEY } from "@/lib/theme";

// 12×12 pixel icons, drawn at 24px so every pixel is 2px.
const MOON = [
  "....mmmm....",
  "..mmmm......",
  ".mmmm.......",
  ".mmm........",
  "mmmm........",
  "mmmm........",
  "mmmm........",
  "mmmmm.......",
  ".mmmmm....m.",
  ".mmmmmmmmmm.",
  "..mmmmmmmm..",
  "....mmmm....",
];
const SUN = [
  ".....yy.....",
  ".y...yy...y.",
  "..y......y..",
  "....yyyy....",
  "...yyyyyy...",
  "yy.yyyyyy.yy",
  "yy.yyyyyy.yy",
  "...yyyyyy...",
  "....yyyy....",
  "..y......y..",
  ".y...yy...y.",
  ".....yy.....",
];

/** Header button that flips between light and dark, and remembers the choice. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Until someone picks a theme here, follow the system setting as it changes.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(THEME_KEY);
      } catch {
        // Storage blocked: treat as no saved choice.
      }
      if (!stored) document.documentElement.dataset.theme = media.matches ? "dark" : "light";
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-ink/10 sm:h-10 sm:w-10"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" shapeRendering="crispEdges" className="h-6 w-6">
        {/* Icons follow the attribute, not React state, so they're right from the first paint. */}
        <Sprite rows={MOON} palette={{ m: "currentColor" }} className="dark:hidden" />
        <Sprite rows={SUN} palette={{ y: "#F2BC5B" }} className="hidden dark:inline" />
      </svg>
    </button>
  );
}
