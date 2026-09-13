const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly maxBuckets = 1_000,
    private readonly windowMs = WINDOW_MS,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    for (const [bucketKey, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
    const existing = this.buckets.get(key);
    if (existing && existing.count >= this.limit) return false;
    if (!existing && this.buckets.size >= this.maxBuckets) return false;
    this.buckets.set(key, { count: (existing?.count ?? 0) + 1, resetAt: existing?.resetAt ?? now + this.windowMs });
    return true;
  }
}

function clientKey(request: Request): string {
  // Amplify provides this header. Treat it only as a partition key; the global
  // limiter below still bounds work if a caller spoofs it.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function clientKeyFromHeaders(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const joinByClient = new FixedWindowLimiter(10);
const joinGlobal = new FixedWindowLimiter(100, 1);
const lookupByClient = new FixedWindowLimiter(30);
const lookupGlobal = new FixedWindowLimiter(240, 1);

export function allowJoinRequest(request: Request): boolean {
  return joinByClient.allow(clientKey(request)) && joinGlobal.allow("all");
}

export function allowLookupRequest(request: Request): boolean {
  return allowLookupHeaders(request.headers);
}

export function allowLookupHeaders(headers: Headers): boolean {
  return lookupByClient.allow(clientKeyFromHeaders(headers)) && lookupGlobal.allow("all");
}
