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
// Each code request sends an email through SES, so keep these tighter.
const codeByClient = new FixedWindowLimiter(5);
const codeGlobal = new FixedWindowLimiter(60, 1);
const verifyByClient = new FixedWindowLimiter(10);
const verifyGlobal = new FixedWindowLimiter(120, 1);

const voteByClient = new FixedWindowLimiter(40);
const voteGlobal = new FixedWindowLimiter(600, 1);
const reviewByClient = new FixedWindowLimiter(6);
const reviewGlobal = new FixedWindowLimiter(120, 1);

export function allowVoteRequest(request: Request): boolean {
  return voteByClient.allow(clientKey(request)) && voteGlobal.allow("all");
}

export function allowReviewRequest(request: Request): boolean {
  return reviewByClient.allow(clientKey(request)) && reviewGlobal.allow("all");
}

export function allowCodeRequest(request: Request): boolean {
  return codeByClient.allow(clientKey(request)) && codeGlobal.allow("all");
}

export function allowVerifyRequest(request: Request): boolean {
  return verifyByClient.allow(clientKey(request)) && verifyGlobal.allow("all");
}

export function allowJoinRequest(request: Request): boolean {
  return joinByClient.allow(clientKey(request)) && joinGlobal.allow("all");
}

export function allowLookupRequest(request: Request): boolean {
  return allowLookupHeaders(request.headers);
}

export function allowLookupHeaders(headers: Headers): boolean {
  return lookupByClient.allow(clientKeyFromHeaders(headers)) && lookupGlobal.allow("all");
}
