import Link from "next/link";
import { AccountLink } from "@/components/AccountLink";
import { NavLinks } from "@/components/NavLinks";
import { LOGO_PALETTE, LOGO_ROWS } from "@/components/pixel/logo";
import { Sprite } from "@/components/pixel/Sprite";

/** The D Lens mark in pixel art. Drawn on a 32px grid, so 32px (or a multiple) keeps every pixel crisp. */
export function DocketMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" shapeRendering="crispEdges" className={className}>
      <Sprite rows={LOGO_ROWS} palette={LOGO_PALETTE} />
    </svg>
  );
}

export function SiteHeader({ tone = "plain" }: { tone?: "sky" | "plain" }) {
  return (
    <header className={tone === "sky" ? "relative z-20" : "border-b border-rule bg-white"}>
      <div className="page flex items-center justify-between gap-1 py-3 sm:gap-2 sm:py-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full text-[1.375rem] font-semibold tracking-tight text-ink">
          <DocketMark />
          <span className="hidden min-[400px]:inline">Docket</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-4">
          <NavLinks />
          <Link href="/#address" className="btn btn-primary hidden h-11 rounded-full px-5 lg:inline-flex">
            Find your group
          </Link>
          <AccountLink />
        </nav>
      </div>
    </header>
  );
}

const FOOTER_SECTIONS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Your neighborhood",
    links: [
      { href: "/", label: "Neighborhood feed" },
      { href: "/#address", label: "Find your group" },
      { href: "/groups", label: "All groups" },
    ],
  },
  {
    title: "Explore Fremont",
    links: [
      { href: "/news", label: "News" },
      { href: "/places", label: "Places map and live incidents" },
    ],
  },
  {
    title: "Docket",
    links: [
      { href: "/chat", label: "Ask Docket" },
      { href: "/about", label: "About Docket" },
      { href: "/signin", label: "Sign in" },
    ],
  },
];

/** Site footer: every section of Docket one tap away, from any page. */
export function SiteFooter() {
  return (
    // pb-20 leaves room for the chat bubble in the corner.
    <footer className="border-t border-rule bg-white pb-20">
      <div className="page grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 rounded-full text-ink">
            {/* Default 32px: the logo is pixel art on a 32px grid. */}
            <DocketMark />
            <span className="text-lg font-semibold">Docket</span>
          </Link>
          <p className="mt-2 max-w-xs text-sm text-ink-muted">Fremont city hall, read for your neighborhood</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="eyebrow">{section.title}</h2>
              <ul className="mt-3 grid gap-1">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="inline-block py-1.5 text-base text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="page border-t border-rule py-5">
        <p className="text-sm text-ink-muted">Groups, agenda items and votes marked sample are demo data until the reading agent goes live.</p>
      </div>
    </footer>
  );
}
