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

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-white pb-20">
      <div className="page flex flex-col gap-3 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-ink">
          <DocketMark />
          <span className="font-semibold">Docket</span>
          <span className="text-ink-muted">· Fremont city hall, read for your neighborhood</span>
        </p>
        <p>
          Groups, agenda items and votes marked sample are demo data until the reading agent goes live.{" "}
          <Link href="/about" className="link font-medium">
            About Docket
          </Link>
        </p>
      </div>
    </footer>
  );
}
