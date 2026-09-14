"use client";

import { useMemo } from "react";
import { linkify } from "@/lib/post-media";
import type { FeedMedia } from "@/lib/posts-types";

// What a post shows: its text with clickable links, its photos or video, and a card for the first
// link when there's no media. Links open in a new tab and never pass Docket as the referrer.

const LINK_REL = "noopener noreferrer nofollow ugc";

export function PostText({ text, className }: { text: string; className: string }) {
  const parts = useMemo(() => linkify(text), [text]);
  if (!text) return null;
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.type === "link" ? (
          <a key={i} href={part.href} target="_blank" rel={LINK_REL} className="link break-all">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function LinkCard({ text }: { text: string }) {
  const link = useMemo(() => linkify(text).find((p) => p.type === "link"), [text]);
  if (!link || link.type !== "link") return null;
  const url = new URL(link.href);
  const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  return (
    <a
      href={link.href}
      target="_blank"
      rel={LINK_REL}
      className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-rule px-3.5 py-3 transition-colors hover:bg-sky-mist"
    >
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-mist text-lg">
        🔗
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink">{link.host}</span>
        {path ? <span className="block truncate text-sm text-ink-muted">{path}</span> : null}
      </span>
      <span aria-hidden="true" className="shrink-0 text-ink-muted">
        ↗
      </span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

type ShownMedia = FeedMedia & { url: string };

/**
 * A post's photos or video. Neighbors only receive files that passed the content check; on their own
 * post, the author also sees files still being checked (marked) and a notice for removed ones.
 */
export function MediaGallery({ media, author }: { media: FeedMedia[]; author: string }) {
  if (!media.length) return null;
  const shown = media.filter((m): m is ShownMedia => Boolean(m.url));
  const notices = [...new Set(media.map((m) => m.notice).filter((n): n is string => Boolean(n)))];
  const removed = media.some((m) => m.review === "blocked" || m.review === "failed");
  return (
    <>
      {shown.length ? <Gallery media={shown} author={author} /> : null}
      {notices.map((notice) => (
        <p key={notice} role="note" className={`mt-2 rounded-xl px-3 py-2 text-sm ${removed ? "bg-signal-wash text-signal" : "bg-ochre-wash text-ochre"}`}>
          {notice}
        </p>
      ))}
    </>
  );
}

function CheckingBadge({ media }: { media: FeedMedia }) {
  return media.review === "pending" ? (
    <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-xs font-semibold text-white">Being checked</span>
  ) : null;
}

function Gallery({ media, author }: { media: ShownMedia[]; author: string }) {
  const video = media.find((m) => m.kind === "video");
  if (video) {
    const ratio = video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
    return (
      <div className="relative mt-3 overflow-hidden rounded-xl border border-rule bg-black">
        <CheckingBadge media={video} />
        <video
          src={video.url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Video shared by ${author}`}
          className="mx-auto block max-h-[32rem] w-full"
          style={{ aspectRatio: ratio }}
        />
      </div>
    );
  }

  const single = media.length === 1;
  return (
    <ul aria-label={`${media.length === 1 ? "Photo" : `${media.length} photos`} shared by ${author}`} className={`mt-3 grid gap-1.5 overflow-hidden rounded-xl ${single ? "" : "grid-cols-2"}`}>
      {media.map((m, i) => {
        const ratio = single && m.width && m.height ? `${m.width} / ${m.height}` : undefined;
        return (
          <li key={m.url} className={`relative ${media.length === 3 && i === 0 ? "row-span-2" : ""}`}>
            <CheckingBadge media={m} />
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block h-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- media links are signed and short-lived. */}
              <img
                src={m.url}
                alt={`Photo ${i + 1} of ${media.length} shared by ${author}`}
                loading="lazy"
                className={`block w-full border border-rule bg-sky-mist object-cover ${single ? "max-h-[32rem] rounded-xl" : "h-full min-h-40 rounded-lg sm:min-h-52"}`}
                style={ratio ? { aspectRatio: ratio } : undefined}
              />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
