// Fremont time, regardless of where the server or visitor is.
const TZ = "America/Los_Angeles";

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });

const partsFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", weekday: "short" });

/** { month: "Sep", day: "15", weekday: "Tue" } in Fremont time. */
export function dateParts(iso: string) {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { month: parts.month, day: parts.day, weekday: parts.weekday };
}

export const formatNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
export const formatMonthDay = (iso: string) => monthDay.format(new Date(iso));

export function relativeUntil(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

export function relativeSince(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${formatDate(iso)}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "Two are close by" reads better than "2 are close by" in prose. */
export const countWord = (n: number) => NUMBER_WORDS[n] ?? formatNumber(n);
