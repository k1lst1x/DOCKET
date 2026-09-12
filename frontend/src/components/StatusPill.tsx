import type { ItemStatus } from "@/lib/types";

const STYLES: Record<ItemStatus, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-ochre-wash text-ochre" },
  approved: { label: "Approved", className: "bg-park-wash text-park" },
  watching: { label: "Watching", className: "bg-sky-mist text-ink" },
  decided: { label: "Decided", className: "bg-white text-ink ring-1 ring-inset ring-ink/40" },
  dismissed: { label: "Dismissed", className: "bg-white text-ink-muted ring-1 ring-inset ring-rule" },
};

export function StatusPill({ status }: { status: ItemStatus }) {
  const { label, className } = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold ${className}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
