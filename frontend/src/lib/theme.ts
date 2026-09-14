export type Theme = "light" | "dark";

export const THEME_KEY = "docket-theme";

// Inlined in <head> so the saved (or system) theme is on <html> before the first paint.
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t}catch(e){d.dataset.theme="light"}})();`;

/**
 * A category color (news topic, place kind, incident type) that stays readable in both themes:
 * unchanged in light mode, mixed toward white in dark mode (see --accent-lift in globals.css).
 */
export function readableAccent(color: string) {
  return `color-mix(in srgb, ${color}, #ffffff var(--accent-lift))`;
}
