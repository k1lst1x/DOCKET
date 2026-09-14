import type { Metadata, Viewport } from "next";
import { Figtree, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Source_Serif_4({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Docket — Fremont city hall, read for your neighborhood",
    template: "%s · Docket",
  },
  description:
    "Docket reads Fremont, California city-hall agendas and tells neighborhood groups what affects their blocks, before the deadline.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#8DC2F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0F151B" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme on <html> before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
