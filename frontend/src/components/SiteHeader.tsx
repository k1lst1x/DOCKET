import Link from "next/link";

export function DocketMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="6" fill="#262626" />
      <path d="M9 7h9.5a6.5 6.5 0 0 1 6.5 6.5V25H9z" fill="#FFFFFF" />
      <path d="M13 13h8M13 17h8M13 21h5" stroke="#262626" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader({ tone = "plain" }: { tone?: "sky" | "plain" }) {
  return (
    <header className={tone === "sky" ? "relative z-20" : "border-b border-rule bg-white"}>
      <div className="page flex items-center justify-between gap-3 py-3 sm:py-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-sm text-[1.375rem] font-semibold tracking-tight text-ink">
          <DocketMark />
          Docket
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 sm:gap-8">
          <Link href="/groups" className="rounded-sm px-2 py-2 text-base font-medium text-ink hover:underline hover:underline-offset-4">
            Groups
          </Link>
          <span className="hidden text-base text-ink-soft md:inline">Fremont, California</span>
          <Link href="/#address" className="btn btn-primary h-11 px-4 sm:px-5">
            Find your group
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-white">
      <div className="page flex flex-col gap-3 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-ink">
          <DocketMark className="h-6 w-6" />
          <span className="font-semibold">Docket</span>
          <span className="text-ink-muted">· Fremont city hall, read for your neighborhood</span>
        </p>
        <p>Groups and agenda items shown are sample data until the reading agent goes live.</p>
      </div>
    </footer>
  );
}
