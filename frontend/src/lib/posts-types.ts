// Home feed: neighbors' posts, replies and likes. Shared by the API and the browser.

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
  body: string;
  createdAt: string;
  author: FeedAuthor;
  /** Where it was posted; null means All of Fremont. */
  neighborhood: { slug: string; name: string } | null;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  mine: boolean;
  sample: boolean;
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

export type PostErrorCode = "not_signed_in" | "invalid_post" | "post_blocked" | "not_found" | "forbidden" | "busy" | "unavailable";
