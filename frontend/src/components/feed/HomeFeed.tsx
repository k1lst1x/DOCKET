"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { timeAgo } from "@/components/places/LivePanel";
import { moderateText } from "@/lib/moderation";
import { areaBySlug, neighborhoodForGroups, NEIGHBORHOODS } from "@/lib/places";
import { ACCEPT_MEDIA, hasBlockedLink } from "@/lib/post-media";
import { POST_MAX_LENGTH, sampleFeed, sampleReplies } from "@/lib/posts-shared";
import type { FeedPage, FeedPost, PostErrorCode } from "@/lib/posts-types";
import { AttachButton, AttachmentPreviews, EmojiButton, insertAtCursor, useAttachments } from "./ComposerMedia";
import { LinkCard, MediaGallery, PostText } from "./PostContent";

// The home feed: neighbors posting about Fremont. Read the whole city, your own neighborhoods or any
// one neighborhood; post to your neighborhood or another; reply and like. Posts can carry up to four
// photos or one video (up to 5 minutes), links and emoji. New posts arrive every 15 seconds behind a
// "Show new posts" button so the list doesn't jump while you read.

type Me = { signedIn: false } | { signedIn: true; name: string; groups: { slug: string }[] };

const POLL_MS = 15_000;
const FEED_PARAM = /^(all|mine|[a-z0-9]+(-[a-z0-9]+)*)$/;

const ERRORS: Record<PostErrorCode, string> = {
  not_signed_in: "Your sign-in has expired. Sign in again to post.",
  invalid_post: "Write something up to 500 characters or add a photo or video, then pick where to post it.",
  post_blocked: "That includes language Docket doesn't allow, such as swear words, slurs or threats. Please rephrase it.",
  link_blocked: "Links need to start with http:// or https://.",
  media_invalid: "One of the photos or videos didn't finish uploading. Remove it and add it again.",
  media_blocked: "One of the photos or videos can't be posted because Docket's automatic check flagged it. Remove it to post.",
  media_unreviewable: "Docket couldn't check one of the photos or videos. Try a JPEG or PNG photo, or an MP4 (H.264) video.",
  media_unavailable: "Photo and video posts aren't available right now. You can still post text.",
  not_found: "That post isn't available anymore.",
  forbidden: "You can only delete your own posts.",
  busy: "You're posting quickly. Wait a minute, then try again.",
  unavailable: "Docket couldn't save that right now. Try again in a moment.",
};

type Result<T> = { ok: true; data: T } | { ok: false; code: PostErrorCode };

async function send<T>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data) return { ok: true, data: data as T };
    return { ok: false, code: ((data as { error?: PostErrorCode } | null)?.error ?? "unavailable") as PostErrorCode };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

const AVATAR_COLORS = ["#2f6a31", "#1d4ed8", "#9a3412", "#6d28d9", "#0f766e", "#be185d", "#334155"];

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {(name.trim().charAt(0) || "?").toUpperCase()}
    </span>
  );
}

const absoluteTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(new Date(iso));

function scopeLabel(scope: string): string {
  if (scope === "all") return "All of Fremont";
  if (scope === "mine") return "My neighborhood";
  return areaBySlug(scope)?.name ?? "Neighborhood";
}

export function HomeFeed() {
  const [me, setMe] = useState<Me | null>(null);
  const [scope, setScope] = useState("all");
  const [hydrated, setHydrated] = useState(false);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [live, setLive] = useState(true);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [incoming, setIncoming] = useState<FeedPost[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const staticSite = useRef(false);
  const postsRef = useRef<FeedPost[]>([]);
  const scopeRef = useRef(scope);
  const homeSlugsRef = useRef<string[]>([]);
  postsRef.current = posts;
  scopeRef.current = scope;

  const homeSlugs = useMemo(() => {
    if (!me?.signedIn) return [];
    const slugs = me.groups.map((g) => neighborhoodForGroups([g.slug])?.slug).filter((s): s is string => Boolean(s));
    return [...new Set(slugs)];
  }, [me]);
  homeSlugsRef.current = homeSlugs;
  const signedIn = Boolean(me?.signedIn);

  useEffect(() => {
    const feed = new URLSearchParams(window.location.search).get("feed");
    if (feed && FEED_PARAM.test(feed) && (feed === "all" || feed === "mine" || areaBySlug(feed))) setScope(feed);
    setHydrated(true);
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { signedIn: false }))
      .then((data: Me) => active && setMe(data.signedIn ? data : { signedIn: false }))
      .catch(() => active && setMe({ signedIn: false }));
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      active = false;
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (scope === "all") url.searchParams.delete("feed");
    else url.searchParams.set("feed", scope);
    window.history.replaceState(window.history.state, "", url);
  }, [hydrated, scope]);

  const fetchPage = useCallback(async (forScope: string, before: string | null): Promise<FeedPage> => {
    if (!staticSite.current) {
      const params = new URLSearchParams({ scope: forScope });
      if (before) params.set("before", before);
      const res = await fetch(`/api/posts?${params}`, { cache: "no-store" });
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (res.ok && isJson) return (await res.json()) as FeedPage;
      if (res.status === 404 && !isJson) {
        // The static preview has no API routes: show the saved sample posts, read-only.
        staticSite.current = true;
        setReadOnly(true);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    }
    const slugs = forScope === "all" ? null : forScope === "mine" ? homeSlugsRef.current : [forScope];
    return { posts: before ? [] : sampleFeed(Date.now(), slugs), nextBefore: null, live: false, scope: forScope, neighborhoods: slugs ?? [] };
  }, []);

  // Load the feed whenever the scope changes.
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    setStatus("loading");
    setPosts([]);
    setIncoming([]);
    fetchPage(scope, null)
      .then((page) => {
        if (!active) return;
        setPosts(page.posts);
        setNextBefore(page.nextBefore);
        setLive(page.live);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [hydrated, scope, fetchPage, reloadKey]);

  // Real time: new posts wait behind a button; like and reply counts update in place.
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(async () => {
      if (document.hidden || staticSite.current) return;
      const forScope = scopeRef.current;
      try {
        const page = await fetchPage(forScope, null);
        if (scopeRef.current !== forScope) return;
        const current = postsRef.current;
        const known = new Set(current.map((p) => p.id));
        const newest = current.length ? Date.parse(current[0].createdAt) : 0;
        const fresh = page.posts.filter((p) => !known.has(p.id) && Date.parse(p.createdAt) > newest);
        if (fresh.length) {
          setIncoming((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...fresh.filter((p) => !seen.has(p.id)), ...prev];
          });
        }
        const latest = new Map(page.posts.map((p) => [p.id, p]));
        setPosts((list) =>
          list.map((p) => {
            const u = latest.get(p.id);
            return u ? { ...p, likeCount: u.likeCount, replyCount: u.replyCount, likedByMe: u.likedByMe } : p;
          }),
        );
        setLive(page.live);
      } catch {
        setLive(false);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [hydrated, fetchPage]);

  const showIncoming = () => {
    setPosts((list) => {
      const known = new Set(list.map((p) => p.id));
      return [...incoming.filter((p) => !known.has(p.id)), ...list];
    });
    setIncoming([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(scope, nextBefore);
      setPosts((list) => {
        const known = new Set(list.map((p) => p.id));
        return [...list, ...page.posts.filter((p) => !known.has(p.id))];
      });
      setNextBefore(page.nextBefore);
    } catch {
      // Keep the button; another tap retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const updatePost = (id: string, patch: Partial<FeedPost>) => setPosts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removePost = (id: string) => setPosts((list) => list.filter((p) => p.id !== id));

  const onPosted = (post: FeedPost) => {
    const slug = post.neighborhood?.slug ?? null;
    const fits = scope === "all" || (scope === "mine" && slug !== null && homeSlugs.includes(slug)) || scope === slug;
    if (fits) setPosts((list) => [post, ...list.filter((p) => p.id !== post.id)]);
    return fits;
  };

  const neighborhoodOptions = useMemo(() => [...NEIGHBORHOODS].sort((a, b) => a.name.localeCompare(b.name)), []);

  return (
    <section aria-labelledby="feed-heading" className="min-w-0">
      <h2 id="feed-heading" className="sr-only">
        Neighborhood feed
      </h2>

      {me && !me.signedIn ? (
        <div className="mb-4 rounded-2xl bg-[linear-gradient(135deg,#8DC2F5_0%,#DDEBF6_100%)] p-5 sm:p-6">
          <p className="display text-[1.75rem] leading-tight text-ink sm:text-[2.125rem]">What&apos;s happening in your neighborhood?</p>
          <p className="mt-2 max-w-read text-base text-ink-soft">
            Fremont neighbors share news, questions, lost pets and city-hall heads-ups here. Read along, or sign in to post to your neighborhood or
            any other.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/signin?next=%2F" className="btn btn-primary h-11 rounded-full px-5">
              Sign in to post
            </Link>
            <Link href="/groups" className="btn btn-secondary h-11 rounded-full px-5">
              Find your group
            </Link>
          </div>
        </div>
      ) : null}

      {me?.signedIn && !readOnly ? (
        <Composer me={me} homeSlugs={homeSlugs} scope={scope} onPosted={onPosted} onShowScope={setScope} />
      ) : null}
      {readOnly ? (
        <p className="mb-4 rounded-2xl bg-white p-4 text-base text-ink-soft">This preview shows sample posts. Posting, replies and likes work on the full Docket site.</p>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-rule bg-sky-mist/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:bg-white/95 sm:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Choose a feed" className="flex gap-1 rounded-full bg-white p-1 sm:bg-sky-mist">
            {(["all", "mine"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={scope === id}
                onClick={() => setScope(id)}
                className={`h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-colors ${scope === id ? "bg-ink text-white" : "text-ink hover:bg-white"}`}
              >
                {id === "all" ? "All Fremont" : "My neighborhood"}
              </button>
            ))}
          </div>
          <label htmlFor="feed-neighborhood" className="sr-only">
            Browse a neighborhood
          </label>
          <select
            id="feed-neighborhood"
            value={scope !== "all" && scope !== "mine" ? scope : ""}
            onChange={(e) => setScope(e.target.value || "all")}
            className="field h-11 min-w-0 flex-1 basis-40 rounded-full pr-9 text-sm"
          >
            <option value="">Browse a neighborhood…</option>
            {neighborhoodOptions.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.name}
              </option>
            ))}
          </select>
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[#d93025]" : "bg-ochre"}`} />
            {live ? "Live" : "Reconnecting"}
          </span>
        </div>
      </div>

      {incoming.length ? (
        <div className="sticky top-16 z-10 mb-3 flex justify-center">
          <button type="button" onClick={showIncoming} aria-live="polite" className="btn btn-primary h-10 rounded-full px-5 text-sm shadow-lg">
            Show {incoming.length} new {incoming.length === 1 ? "post" : "posts"}
          </button>
        </div>
      ) : null}

      {scope === "mine" && me && !me.signedIn ? (
        <EmptyCard title="Sign in to see your neighborhood" body="Once you're signed in and in a neighborhood group, this feed shows posts from where you live.">
          <Link href="/signin?next=%2F%3Ffeed%3Dmine" className="btn btn-primary h-11 rounded-full px-5">
            Sign in
          </Link>
        </EmptyCard>
      ) : scope === "mine" && me?.signedIn && homeSlugs.length === 0 ? (
        <EmptyCard title="Join a neighborhood group" body="Your neighborhood feed fills in once you join the group for where you live.">
          <Link href="/groups" className="btn btn-primary h-11 rounded-full px-5">
            Find your group
          </Link>
        </EmptyCard>
      ) : status === "loading" ? (
        <ul aria-hidden="true" className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-36 animate-pulse rounded-2xl bg-white" />
          ))}
        </ul>
      ) : status === "error" ? (
        <EmptyCard title="The feed couldn't load" body="Check your connection. Docket will keep trying.">
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn btn-secondary h-11 rounded-full px-5">
            Try again
          </button>
        </EmptyCard>
      ) : posts.length === 0 ? (
        <EmptyCard
          title={`No posts in ${scopeLabel(scope)} yet`}
          body={signedIn ? "Start the conversation: the post box above posts here." : "Sign in to start the conversation."}
        />
      ) : (
        <ul aria-label={`Posts in ${scopeLabel(scope)}`} className="grid gap-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} signedIn={signedIn} readOnly={readOnly} now={now} onScope={setScope} onUpdate={updatePost} onRemove={removePost} />
          ))}
        </ul>
      )}

      {nextBefore && status === "ready" ? (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn btn-secondary mt-4 h-11 w-full rounded-full">
          {loadingMore ? "Loading…" : "Show older posts"}
        </button>
      ) : null}
    </section>
  );
}

function EmptyCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-rule bg-white p-6 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-base text-ink-soft">{body}</p>
      {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
    </div>
  );
}

function LanguageWarning({ id, matches }: { id: string; matches: string[] }) {
  return (
    <p id={id} role="alert" className="mt-2 rounded-xl bg-signal-wash px-3 py-2 text-sm text-signal">
      <span className="font-semibold">Please rephrase before posting.</span> Posts can&apos;t include swear words, slurs or threats
      {matches.length ? `: ${matches.map((m) => `“${m.length > 30 ? `${m.slice(0, 30)}…` : m}”`).join(", ")}` : ""}.
    </p>
  );
}

function Composer({
  me,
  homeSlugs,
  scope,
  onPosted,
  onShowScope,
}: {
  me: Extract<Me, { signedIn: true }>;
  homeSlugs: string[];
  scope: string;
  onPosted: (post: FeedPost) => boolean;
  onShowScope: (scope: string) => void;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ slug: string; name: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments();

  // Default audience: the neighborhood being browsed, else your own, else all of Fremont.
  const defaultTarget = scope !== "all" && scope !== "mine" ? scope : (homeSlugs[0] ?? "fremont");
  const audience = target ?? defaultTarget;
  const language = useMemo(() => moderateText(body), [body]);
  const badLink = useMemo(() => hasBlockedLink(body), [body]);
  const length = body.trim().length;
  const over = length > POST_MAX_LENGTH;
  const hasMedia = attachments.items.length > 0;
  const canPost = (length > 0 || hasMedia) && !over && language.ok && !badLink && !attachments.uploading && !attachments.failed && !busy;
  const neighborhoods = useMemo(() => [...NEIGHBORHOODS].sort((a, b) => a.name.localeCompare(b.name)), []);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError(null);
    setPosted(null);
    const result = await send<{ post: FeedPost }>("/api/posts", "POST", {
      body,
      neighborhood: audience === "fremont" ? null : audience,
      media: attachments.media.length ? attachments.media : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(ERRORS[result.code]);
      return;
    }
    setBody("");
    attachments.clear();
    if (textRef.current) textRef.current.style.height = "auto";
    const shown = onPosted(result.data.post);
    const where = result.data.post.neighborhood;
    if (!shown) setPosted(where ? { slug: where.slug, name: where.name } : { slug: "all", name: "All of Fremont" });
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-2xl border border-rule bg-white p-4 sm:p-5">
      <div className="flex gap-3">
        <Avatar name={me.name} />
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-body`} className="sr-only">
            Write a post
          </label>
          <textarea
            ref={textRef}
            id={`${id}-body`}
            value={body}
            rows={2}
            maxLength={POST_MAX_LENGTH + 50}
            onChange={(e) => {
              setBody(e.target.value);
              setPosted(null);
              resize(e.target);
            }}
            onPaste={(e) => {
              // Pasting a screenshot or copied photo attaches it.
              const files = Array.from(e.clipboardData.files);
              if (files.length && attachments.canAddMore) {
                e.preventDefault();
                void attachments.add(files);
              }
            }}
            placeholder={`What's happening in ${areaBySlug(audience)?.name ?? "Fremont"}?`}
            aria-invalid={!language.ok || over || badLink}
            aria-describedby={!language.ok ? `${id}-language` : badLink ? `${id}-link` : undefined}
            className="block min-h-[4.5rem] w-full resize-none bg-transparent py-2 text-lg text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <AttachmentPreviews items={attachments.items} onRemove={attachments.remove} />
          {!language.ok ? <LanguageWarning id={`${id}-language`} matches={language.matches} /> : null}
          {badLink ? (
            <p id={`${id}-link`} role="alert" className="mt-2 rounded-xl bg-signal-wash px-3 py-2 text-sm text-signal">
              {ERRORS.link_blocked}
            </p>
          ) : null}
          {attachments.error ? (
            <p role="alert" className="mt-2 rounded-xl bg-signal-wash px-3 py-2 text-sm font-semibold text-signal">
              {attachments.error}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-xl bg-signal-wash px-3 py-2 text-sm font-semibold text-signal">
              {error}
            </p>
          ) : null}
          {posted ? (
            <p role="status" className="mt-2 text-sm text-park">
              Posted to {posted.name}.{" "}
              <button type="button" className="link" onClick={() => onShowScope(posted.slug)}>
                See it there
              </button>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
            <div className="-ml-2 flex items-center">
              <AttachButton onFiles={(files) => void attachments.add(files)} disabled={!attachments.canAddMore || busy} accept={ACCEPT_MEDIA} multiple />
              <EmojiButton
                onPick={(emoji) =>
                  insertAtCursor(textRef.current, body, emoji, (next) => {
                    setBody(next);
                    setPosted(null);
                  })
                }
              />
            </div>
            <label htmlFor={`${id}-target`} className="text-sm text-ink-soft">
              Post to
            </label>
            <select id={`${id}-target`} value={audience} onChange={(e) => setTarget(e.target.value)} className="field h-10 w-auto min-w-0 max-w-full flex-1 basis-40 rounded-full pr-9 text-sm">
              {homeSlugs.map((slug) => (
                <option key={`home-${slug}`} value={slug}>
                  {`${areaBySlug(slug)?.name ?? slug} (your neighborhood)`}
                </option>
              ))}
              <option value="fremont">All of Fremont</option>
              <optgroup label="Other neighborhoods">
                {neighborhoods
                  .filter((n) => !homeSlugs.includes(n.slug))
                  .map((n) => (
                    <option key={n.slug} value={n.slug}>
                      {n.name}
                    </option>
                  ))}
              </optgroup>
            </select>
            <span className={`ml-auto font-mono text-sm ${over ? "text-signal" : "text-ink-muted"}`} aria-live="polite">
              {POST_MAX_LENGTH - length}
            </span>
            <button type="submit" disabled={!canPost} className="btn btn-primary h-10 rounded-full px-5 text-sm">
              {busy ? "Posting…" : attachments.checking ? "Checking…" : attachments.uploading ? "Uploading…" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function PostCard({
  post,
  signedIn,
  readOnly,
  now,
  onScope,
  onUpdate,
  onRemove,
}: {
  post: FeedPost;
  signedIn: boolean;
  readOnly: boolean;
  now: number;
  onScope: (scope: string) => void;
  onUpdate: (id: string, patch: Partial<FeedPost>) => void;
  onRemove: (id: string) => void;
}) {
  const [threadOpen, setThreadOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInHint, setSignInHint] = useState(false);
  const busy = useRef(false);

  async function toggleLike() {
    if (readOnly) return;
    if (!signedIn) {
      setSignInHint(true);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    const before = { likedByMe: post.likedByMe, likeCount: post.likeCount };
    const liked = !post.likedByMe;
    onUpdate(post.id, { likedByMe: liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) });
    const result = await send<{ likeCount: number; likedByMe: boolean }>(`/api/posts/${post.id}/like`, liked ? "POST" : "DELETE");
    busy.current = false;
    if (result.ok) onUpdate(post.id, result.data);
    else {
      onUpdate(post.id, before);
      setError(ERRORS[result.code]);
    }
  }

  async function remove() {
    const result = await send<{ ok: true }>(`/api/posts/${post.id}`, "DELETE");
    if (result.ok) onRemove(post.id);
    else {
      setConfirming(false);
      setError(ERRORS[result.code]);
    }
  }

  return (
    <li>
      <article className="rounded-2xl border border-rule bg-white p-4 sm:p-5">
        <div className="flex gap-3">
          <Avatar name={post.author.name} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="text-base font-semibold text-ink">{post.mine ? "You" : post.author.name}</span>
              {post.author.homeNeighborhood ? <span className="text-ink-muted">{post.author.homeNeighborhood}</span> : null}
              <span aria-hidden="true" className="text-ink-muted">
                ·
              </span>
              <time dateTime={post.createdAt} title={absoluteTime(post.createdAt)} className="text-ink-muted">
                {timeAgo(post.createdAt, now)}
              </time>
              {post.sample ? <span className="rounded-full bg-sky-mist px-2 text-xs font-semibold text-ink-soft">Sample</span> : null}
            </p>
            <p className="mt-0.5 text-sm">
              {post.neighborhood ? (
                <button type="button" onClick={() => onScope(post.neighborhood?.slug ?? "all")} className="font-medium text-park hover:underline">
                  <span aria-hidden="true">📍 </span>
                  {post.neighborhood.name}
                </button>
              ) : (
                <button type="button" onClick={() => onScope("all")} className="font-medium text-ink-soft hover:underline">
                  <span aria-hidden="true">🏙️ </span>All of Fremont
                </button>
              )}
            </p>
            <PostText text={post.body} className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed text-ink" />
            {post.media.length ? <MediaGallery media={post.media} author={post.mine ? "you" : post.author.name} /> : <LinkCard text={post.body} />}

            <div className="-ml-2 mt-2 flex flex-wrap items-center gap-1">
              <button
                type="button"
                aria-expanded={threadOpen}
                onClick={() => setThreadOpen((o) => !o)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-ink-soft hover:bg-sky-mist hover:text-ink"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path d="M4 5h12v8H9l-4 3v-3H4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
                <span>{post.replyCount}</span>
                <span className="sr-only">{post.replyCount === 1 ? "reply" : "replies"}, </span>
                <span className="sr-only">{threadOpen ? "hide" : "show"}</span>
              </button>
              <button
                type="button"
                aria-pressed={post.likedByMe}
                onClick={toggleLike}
                disabled={readOnly}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-signal-wash disabled:opacity-60 ${post.likedByMe ? "text-signal" : "text-ink-soft hover:text-signal"}`}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path
                    d="M10 16.5s-6-3.6-6-8.1A3.4 3.4 0 0 1 10 6.2a3.4 3.4 0 0 1 6 2.2c0 4.5-6 8.1-6 8.1z"
                    fill={post.likedByMe ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{post.likeCount}</span>
                <span className="sr-only">{post.likedByMe ? "likes, you liked this" : "likes, like this post"}</span>
              </button>
              {post.mine && !readOnly ? (
                confirming ? (
                  <span className="ml-auto inline-flex items-center gap-2 text-sm">
                    Delete this post?
                    <button type="button" onClick={remove} className="font-semibold text-signal hover:underline">
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="text-ink-soft hover:underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)} className="ml-auto inline-flex h-10 items-center rounded-full px-3 text-sm text-ink-muted hover:bg-sky-mist hover:text-signal">
                    Delete
                  </button>
                )
              ) : null}
            </div>
            {signInHint ? (
              <p className="text-sm text-ink-soft">
                <Link href="/signin?next=%2F" className="link">
                  Sign in
                </Link>{" "}
                to like and reply.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-1 text-sm font-semibold text-signal">
                {error}
              </p>
            ) : null}

            {threadOpen ? (
              <Thread
                post={post}
                signedIn={signedIn}
                readOnly={readOnly}
                now={now}
                onCount={(n) => onUpdate(post.id, { replyCount: n })}
              />
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

function Thread({ post, signedIn, readOnly, now, onCount }: { post: FeedPost; signedIn: boolean; readOnly: boolean; now: number; onCount: (n: number) => void }) {
  const id = useId();
  const [replies, setReplies] = useState<FeedPost[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const language = useMemo(() => moderateText(draft), [draft]);
  const badLink = useMemo(() => hasBlockedLink(draft), [draft]);
  const length = draft.trim().length;

  useEffect(() => {
    let active = true;
    // The static preview has no API; its sample posts' replies come from the saved sample data.
    fetch(`/api/posts/${post.id}/replies`, { cache: "no-store" })
      .then(async (res) => {
        const isJson = res.headers.get("content-type")?.includes("application/json");
        if (res.ok && isJson) return ((await res.json()) as { replies: FeedPost[] }).replies;
        return sampleReplies(post.id, Date.now());
      })
      .catch(() => sampleReplies(post.id, Date.now()))
      .then((list) => active && setReplies(list));
    return () => {
      active = false;
    };
  }, [post.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!length || length > POST_MAX_LENGTH || !language.ok || badLink || busy) return;
    setBusy(true);
    setError(null);
    const result = await send<{ post: FeedPost }>("/api/posts", "POST", { body: draft, parentId: post.id });
    setBusy(false);
    if (!result.ok) {
      setError(ERRORS[result.code]);
      return;
    }
    setDraft("");
    const next = [...(replies ?? []), result.data.post];
    setReplies(next);
    onCount(next.length);
  }

  async function removeReply(replyId: string) {
    const result = await send<{ ok: true }>(`/api/posts/${replyId}`, "DELETE");
    if (!result.ok) {
      setError(ERRORS[result.code]);
      return;
    }
    const next = (replies ?? []).filter((r) => r.id !== replyId);
    setReplies(next);
    onCount(next.length);
  }

  return (
    <div className="mt-3 border-t border-rule pt-3">
      {replies === null ? (
        <p className="text-sm text-ink-muted">Loading replies…</p>
      ) : replies.length === 0 ? (
        <p className="text-sm text-ink-muted">No replies yet.</p>
      ) : (
        <ul aria-label="Replies" className="grid gap-3">
          {replies.map((reply) => (
            <li key={reply.id} className="flex gap-2.5">
              <Avatar name={reply.author.name} size={32} />
              <div className="min-w-0 flex-1 rounded-2xl bg-sky-mist px-3.5 py-2.5">
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                  <span className="font-semibold text-ink">{reply.mine ? "You" : reply.author.name}</span>
                  {reply.author.homeNeighborhood ? <span className="text-ink-muted">{reply.author.homeNeighborhood}</span> : null}
                  <span aria-hidden="true" className="text-ink-muted">
                    ·
                  </span>
                  <time dateTime={reply.createdAt} title={absoluteTime(reply.createdAt)} className="text-ink-muted">
                    {timeAgo(reply.createdAt, now)}
                  </time>
                  {reply.mine && !readOnly ? (
                    <button type="button" onClick={() => removeReply(reply.id)} className="ml-auto text-ink-muted hover:text-signal hover:underline">
                      Delete
                    </button>
                  ) : null}
                </p>
                <PostText text={reply.body} className="mt-0.5 whitespace-pre-wrap break-words text-base text-ink" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {signedIn && !readOnly ? (
        <form onSubmit={submit} className="mt-3">
          <label htmlFor={`${id}-reply`} className="sr-only">
            Reply to {post.author.name}
          </label>
          <div className="flex items-end gap-2 rounded-2xl border border-field bg-white p-1.5 pl-3 focus-within:border-ink">
            <textarea
              ref={draftRef}
              id={`${id}-reply`}
              rows={1}
              value={draft}
              maxLength={POST_MAX_LENGTH + 50}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a reply…"
              aria-invalid={!language.ok || badLink}
              aria-describedby={!language.ok ? `${id}-language` : badLink ? `${id}-link` : undefined}
              className="min-h-[2.5rem] min-w-0 flex-1 resize-none bg-transparent py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <EmojiButton align="right" onPick={(emoji) => insertAtCursor(draftRef.current, draft, emoji, setDraft)} />
            <button type="submit" disabled={busy || !length || length > POST_MAX_LENGTH || !language.ok || badLink} className="btn btn-primary h-10 rounded-full px-4 text-sm">
              {busy ? "…" : "Reply"}
            </button>
          </div>
          {!language.ok ? <LanguageWarning id={`${id}-language`} matches={language.matches} /> : null}
          {badLink ? (
            <p id={`${id}-link`} role="alert" className="mt-2 text-sm text-signal">
              {ERRORS.link_blocked}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm font-semibold text-signal">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
