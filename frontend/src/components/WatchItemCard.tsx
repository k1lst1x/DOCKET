import { Deadline } from "@/components/Deadline";
import { ItemRef } from "@/components/ItemRef";
import { dateParts, formatDateTime } from "@/lib/format";
import type { WatchItem } from "@/lib/types";

/** One surfaced agenda item: deadline date block, reference, title, one-line brief. */
export function WatchItemCard({ item }: { item: WatchItem }) {
  const { month, day, weekday } = dateParts(item.deadline);
  return (
    <li className="card grid overflow-hidden sm:grid-cols-[8.5rem_minmax(0,1fr)]">
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
        <h3 className="mt-2 text-xl font-semibold leading-snug text-ink">{item.title}</h3>
        <p className="reading mt-2 text-ink-soft">{item.brief}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule pt-4">
          <Deadline at={item.deadline} label={item.deadlineKind} />
          <span className="text-sm text-ink-soft">
            {item.body} ·{" "}
            <time dateTime={item.meetingAt} className="font-mono">
              {formatDateTime(item.meetingAt)}
            </time>
          </span>
        </div>
      </div>
    </li>
  );
}
