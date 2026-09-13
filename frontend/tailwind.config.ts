import type { Config } from "tailwindcss";

// Palette sampled from the approved landing reference: open sky, near-black ink,
// park greens. Text colors are paired with their surfaces at 4.5:1 or better.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
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
        sky: {
          top: "#8DC2F5",
          DEFAULT: "#B3D6F6",
          haze: "#DDEBF6",
          mist: "#EEF5FA",
        },
        ink: {
          DEFAULT: "#262626",
          soft: "#474747",
          muted: "#5F6368",
        },
        canvas: "#FFFFFF",
        rule: "#DCE3E8",
        field: "#7A7F85",
        park: {
          DEFAULT: "#2F6A31",
          leaf: "#6DB33F",
          deep: "#1F3D1A",
          wash: "#EAF4E2",
        },
        signal: {
          DEFAULT: "#B3261E",
          wash: "#FBEAE8",
        },
        ochre: {
          DEFAULT: "#865700",
          wash: "#FAF0DC",
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
