// Shapes shared by the issue API and the issue dialog (safe to import client-side).

export interface ClaimView {
  text: string;
  basis: "source" | "inference";
  citation: string | null;
}

export interface PollView {
  id: string;
  question: string;
  kind: "stance" | "choice";
  options: { id: string; label: string; votes: number }[];
  /** Stance polls only: members who gave up their vote. */
  passes: number;
  total: number;
  myChoice: string | null;
}

export interface TrendPoint {
  day: string; // YYYY-MM-DD, Fremont time
  support: number; // cumulative
  oppose: number;
  pass: number;
}

export interface NeighborhoodShare {
  slug: string;
  name: string;
  support: number;
  oppose: number;
  pass: number;
}

export interface ReviewView {
  id: string;
  author: string;
  neighborhood: string | null;
  rating: number;
  body: string;
  createdAt: string;
  mine: boolean;
  sample: boolean;
}

export interface IssueDetail {
  id: string;
  ref: string;
  title: string;
  body: string;
  topic: string | null;
  status: "pending" | "approved" | "watching" | "decided" | "dismissed";
  meetingAt: string | null;
  deadline: string | null;
  deadlineKind: string | null;
  citation: string | null;
  sourceUrl: string | null;
  surfacedAt: string;
  location: { lat: number; lng: number; label: string } | null;
  affectedRadiusM: number | null;
  group: { slug: string; name: string } | null;
  neighborhoods: { slug: string; name: string }[];
  analysis: {
    summary: string;
    pros: ClaimView[];
    cons: ClaimView[];
    facts: { label: string; value: string }[];
    model: string | null;
    generatedAt: string | null;
  } | null;
  polls: PollView[];
  trend: TrendPoint[];
  byNeighborhood: NeighborhoodShare[];
  reviewCount: number;
  /** Null until the viewer has voted or passed on the stance poll. */
  reviews: {
    average: number | null;
    distribution: number[]; // index 0 = rating 1
    items: ReviewView[];
    mine: { rating: number; body: string } | null;
  } | null;
  viewer: {
    signedIn: boolean;
    canVote: boolean;
    closed: boolean;
    hasVoted: boolean;
    votingAs: string | null; // the group that makes the viewer eligible
  };
  sample: { issue: boolean; analysis: boolean; activity: boolean };
}

export type IssueActionErrorCode =
  | "not_signed_in"
  | "not_found"
  | "not_member"
  | "invalid_choice"
  | "closed"
  | "vote_first"
  | "invalid_review"
  | "busy"
  | "unavailable";
