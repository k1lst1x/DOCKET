import type { Config } from "tailwindcss";

// Every theme color is a CSS variable of RGB channels, defined for light and dark in
// globals.css, so opacity modifiers (bg-ink/5) keep working and one attribute switches themes.
// Light palette sampled from the approved landing reference: open sky, near-black ink,
// park greens. Text colors are paired with their surfaces at 4.5:1 or better in both themes.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    // Soft, rounded shapes throughout: controls 12px, cards 20px, panels 28px.
    borderRadius: {
      none: "0",
      sm: "8px",
      DEFAULT: "12px",
      md: "12px",
      lg: "20px",
      xl: "24px",
      "2xl": "28px",
      full: "9999px",
    },
    extend: {
      colors: {
        // "white" is the surface color: white in light mode, the card color in dark mode.
        // Use snow and coal where a color must not change (text on photos, always-dark panels).
        white: token("white"),
        snow: "#FFFFFF",
        coal: "#262626",
        sky: {
          top: token("sky-top"),
          DEFAULT: token("sky"),
          haze: token("sky-haze"),
          mist: token("sky-mist"),
        },
        ink: {
          DEFAULT: token("ink"),
          soft: token("ink-soft"),
          muted: token("ink-muted"),
          strong: token("ink-strong"),
        },
        canvas: token("white"),
        rule: token("rule"),
        field: token("field"),
        park: {
          DEFAULT: token("park"),
          leaf: token("park-leaf"),
          deep: token("park-deep"),
          wash: token("park-wash"),
        },
        signal: {
          DEFAULT: token("signal"),
          wash: token("signal-wash"),
        },
        ochre: {
          DEFAULT: token("ochre"),
          wash: token("ochre-wash"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Nothing renders below 14px.
        xs: ["0.875rem", { lineHeight: "1.35rem" }],
        sm: ["0.875rem", { lineHeight: "1.35rem" }],
        base: ["1.0625rem", { lineHeight: "1.65" }],
        lg: ["1.1875rem", { lineHeight: "1.6" }],
      },
      maxWidth: {
        page: "72rem",
        read: "40rem",
      },
    },
  },
  plugins: [],
};

export default config;
