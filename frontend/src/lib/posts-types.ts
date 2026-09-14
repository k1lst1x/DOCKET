// Home feed: neighbors' posts, replies and likes. Shared by the API and the browser.

import type { PostMediaKind } from "./post-media";

/** A photo or video in a post. */
export interface FeedMedia {
  kind: PostMediaKind;
  /** Temporary signed link; null when the automatic content check removed the file. */
  url: string | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
  /**
   * The automatic content check. Neighbors only ever receive approved files; the author also sees
   * their own files that are still being checked or were removed.
   */
  review: "approved" | "pending" | "blocked" | "failed";
  /** For the author, what happened to a file that isn't approved. */
  notice: string | null;
}

export interface FeedAuthor {
  /** Short display name, e.g. "Priya A." */
  name: string;
  /** Neighborhood name of the author's first group, when they have one. */
  homeNeighborhood: string | null;
}

export interface FeedPost {
  id: string;
  /** Set on replies: the top-level post they answer. */
  parentId: string | null;
  /** May be empty when the post has photos or a video. */
  body: string;
  /** Up to four photos, or one video. Replies have none. */
  media: FeedMedia[];
  createdAt: string;
  author: FeedAuthor;
  /** Where it was posted; null means All of Fremont. */
  neighborhood: { slug: string; name: string } | null;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  mine: boolean;
  sample: boolean;
  /** Written by the Docket agent rather than a neighbor. */
  byDocket: boolean;
  /** For Docket posts: the public documents the post came from. */
  sources: FeedSource[];
}

export interface FeedSource {
  title: string;
  url: string;
}

export interface FeedPage {
  posts: FeedPost[];
  /** Pass as ?before= to load older posts; null when there are no more. */
  nextBefore: string | null;
  /** False when the database is unreachable and saved sample posts are shown. */
  live: boolean;
  scope: string;
  /** For the "My neighborhoods" feed: the neighborhood slugs it covers. */
  neighborhoods: string[];
}

export type PostErrorCode =
  | "not_signed_in"
  | "invalid_post"
  | "post_blocked"
  | "link_blocked"
  | "media_invalid"
  | "media_blocked"
  | "media_unreviewable"
  | "media_unavailable"
  | "not_found"
  | "forbidden"
  | "busy"
  | "unavailable";
