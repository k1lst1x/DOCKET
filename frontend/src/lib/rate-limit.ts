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
// Each login or registration runs a deliberately slow password hash, so cap password guesses per connection.
const loginByClient = new FixedWindowLimiter(10);
const loginGlobal = new FixedWindowLimiter(300, 1);
const registerByClient = new FixedWindowLimiter(6);
const registerGlobal = new FixedWindowLimiter(120, 1);

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

// Each chat message runs retrieval and a Bedrock model call, so keep these modest.
const chatByClient = new FixedWindowLimiter(20);
const chatGlobal = new FixedWindowLimiter(300, 1);

// Home feed: posting and deleting is capped tightly per client; likes can be tapped more often.
const postByClient = new FixedWindowLimiter(8);
const postGlobal = new FixedWindowLimiter(240, 1);
const likeByClient = new FixedWindowLimiter(60);
const likeGlobal = new FixedWindowLimiter(1200, 1);
// Upload tickets: a post can carry four photos, so allow a few posts' worth per minute.
const mediaByClient = new FixedWindowLimiter(16);
const mediaGlobal = new FixedWindowLimiter(240, 1);

export function allowPostRequest(request: Request): boolean {
  return postByClient.allow(clientKey(request)) && postGlobal.allow("all");
}

export function allowMediaRequest(request: Request): boolean {
  return mediaByClient.allow(clientKey(request)) && mediaGlobal.allow("all");
}

export function allowLikeRequest(request: Request): boolean {
  return likeByClient.allow(clientKey(request)) && likeGlobal.allow("all");
}

export function allowChatRequest(request: Request): boolean {
  return chatByClient.allow(clientKey(request)) && chatGlobal.allow("all");
}

// Warm-up pings start the assistant before the first message. They run no model, but each can start a
// runtime session, so they get their own small budget instead of using up the chat limit.
const chatWarmByClient = new FixedWindowLimiter(6);
const chatWarmGlobal = new FixedWindowLimiter(120, 1);

export function allowChatWarmRequest(request: Request): boolean {
  return chatWarmByClient.allow(clientKey(request)) && chatWarmGlobal.allow("all");
}

export function allowLoginRequest(request: Request): boolean {
  return loginByClient.allow(clientKey(request)) && loginGlobal.allow("all");
}

export function allowRegisterRequest(request: Request): boolean {
  return registerByClient.allow(clientKey(request)) && registerGlobal.allow("all");
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
