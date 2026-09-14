// Who is signed in, as the browser sees it. The header, the feed and the places map all need it, so it is
// fetched once and shared: a page opened from another page shows the account at once instead of waiting
// on /api/auth/me again. Anything that signs someone in or out calls forgetMe() so the next read is fresh.

export type Me = { signedIn: false } | { signedIn: true; name: string; groups: { slug: string }[] };

const FRESH_MS = 60_000;

let cached: { me: Me; at: number } | null = null;
let inflight: Promise<Me> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

/** The last known answer, without fetching. Null until the first fetch finishes. */
export function peekMe(): Me | null {
  return cached?.me ?? null;
}

/** The signed-in member, from memory when it's under a minute old. Never rejects: failures read as signed out. */
export function loadMe(maxAgeMs = FRESH_MS): Promise<Me> {
  if (cached && Date.now() - cached.at < maxAgeMs) return Promise.resolve(cached.me);
  if (inflight) return inflight;
  const started = generation;
  const request: Promise<Me> = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (res) => {
      const data = res.ok ? ((await res.json()) as { signedIn?: boolean; name?: string; groups?: { slug: string }[] }) : null;
      const me: Me = data?.signedIn ? { signedIn: true, name: data.name ?? "", groups: data.groups ?? [] } : { signedIn: false };
      // A server error isn't an answer; a 404 is the static preview, which has no accounts.
      if (started === generation && (res.ok || res.status === 404)) cached = { me, at: Date.now() };
      return me;
    })
    .catch((): Me => ({ signedIn: false }))
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Drops the remembered answer (or replaces it, e.g. after signing out) and tells open components to read again. */
export function forgetMe(next?: Me): void {
  generation++;
  inflight = null;
  cached = next ? { me: next, at: Date.now() } : null;
  for (const listener of listeners) listener();
}

export function subscribeMe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
