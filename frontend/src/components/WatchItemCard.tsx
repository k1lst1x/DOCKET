import { Deadline } from "@/components/Deadline";
import { ItemRef } from "@/components/ItemRef";
import { dateParts, formatDateTime } from "@/lib/format";
import type { WatchItem } from "@/lib/types";

interface WatchItemCardProps {
  item: WatchItem;
  /** When given, the title and the "Vote & details" button open the issue dialog. */
  onOpen?: (trigger: HTMLElement) => void;
}

/** One surfaced agenda item: deadline date block, reference, title, one-line brief. */
export function WatchItemCard({ item, onOpen }: WatchItemCardProps) {
  const { month, day, weekday } = dateParts(item.deadline);
  return (
    <li className="card grid overflow-hidden transition-shadow hover:shadow-[0_10px_30px_rgba(38,38,38,0.08)] sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <div className="flex items-baseline gap-3 border-b border-rule bg-sky-mist px-5 py-3 sm:flex-col sm:items-start sm:justify-center sm:gap-1 sm:border-b-0 sm:border-r sm:py-5">
        <span className="font-mono text-sm uppercase tracking-wide text-ink-soft">
          {weekday} {month}
        </span>
        <span className="display text-[2.25rem] leading-none sm:text-[2.75rem]">{day}</span>
        <span className="text-sm text-ink-soft">{item.deadlineKind}</span>
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <ItemRef value={item.ref} />
          <span className="text-sm font-semibold text-park">{item.topic}</span>
        </div>
        <h3 className="mt-2 text-xl font-semibold leading-snug text-ink">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => onOpen(e.currentTarget)}
              className="rounded-sm text-left hover:underline hover:decoration-ink/40 hover:underline-offset-4"
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
        </h3>
        <p className="reading mt-2 text-ink-soft">{item.brief}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-rule pt-4">
          <Deadline at={item.deadline} label={item.deadlineKind} />
          <span className="text-sm text-ink-soft">
            {item.body} ·{" "}
            <time dateTime={item.meetingAt} className="font-mono">
              {formatDateTime(item.meetingAt)}
            </time>
          </span>
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => onOpen(e.currentTarget)}
              aria-label={`${item.title}: summary, vote and reviews`}
              className="on-dark ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-strong"
            >
              Vote &amp; details
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                <path d="M4 8h8M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
