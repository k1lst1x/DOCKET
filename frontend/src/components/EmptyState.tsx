import type { ReactNode } from "react";

/** Rolling park hills, echoing the landing illustration. Decorative only. */
export function Hills({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" className={className}>
      <path d="M0 78C180 38 390 34 610 66s420 44 590-6v60H0z" fill="#6DB33F" opacity="0.45" />
      <path d="M0 98c230-34 470-20 720-12s380-6 480 6v28H0z" fill="#2F6A31" opacity="0.85" />
    </svg>
  );
}

interface EmptyStateProps {
  headline: string;
  body: ReactNode;
  actions?: ReactNode;
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
}

export function EmptyState({ headline, body, actions, headingLevel = "h2", className = "" }: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <section className={`relative overflow-hidden rounded-lg border border-rule bg-sky-mist px-6 pb-20 pt-10 sm:px-10 sm:pt-12 ${className}`}>
      <div className="relative z-10 max-w-read">
        <Heading className="display text-[1.75rem] leading-tight sm:text-[2.125rem]">{headline}</Heading>
        <div className="mt-3 text-lg leading-relaxed text-ink-soft">{body}</div>
        {actions ? <div className="mt-7 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
      <Hills className="absolute inset-x-0 bottom-0 h-14 w-full" />
    </section>
  );
}
