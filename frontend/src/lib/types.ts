/** [longitude, latitude], matching GeoJSON order. */
export type LngLat = [lng: number, lat: number];

export type ItemStatus = "pending" | "approved" | "watching" | "decided" | "dismissed";

export type Role = "member" | "coordinator";

export interface SourceDocument {
  id: string;
  title: string;
  body: string;
  meetingDate: string;
  pageCount: number;
  readAt: string;
  url: string | null;
}

export interface WatchItem {
  id: string;
  /** Row id in the issues table; opens the issue dialog. */
  issueId: string;
  ref: string;
  groupSlug: string;
  title: string;
  body: string;
  meetingAt: string;
  deadline: string;
  deadlineKind: string;
  brief: string;
  topic: string;
  status: ItemStatus;
  score: number;
  scoreReason: string;
  citation: string;
  documentId: string;
  surfacedAt: string;
}

export interface Outcome {
  id: string;
  ref: string;
  title: string;
  body: string;
  decidedOn: string;
  result: "Approved" | "Approved with changes" | "Denied" | "Continued" | "Referred" | "Received and filed" | "No action";
  /** Null when the minutes don't give vote counts. */
  vote: { yes: number; no: number; abstain: number; absent: number } | null;
  groupPosition: "Supported" | "Opposed" | "No position";
  note: string;
  /** The minutes or action document the decision comes from. */
  sourceUrl?: string | null;
}

export interface Group {
  id: string;
  slug: string;
  name: string;
  district: string;
  description: string;
  boundary: LngLat[];
  memberCount: number;
  watchlist: string[];
  foundedOn: string;
  lastActivityAt: string;
  meets: string;
}

export interface GroupDetail extends Group {
  items: WatchItem[];
  outcomes: Outcome[];
}

export interface UrgentItem {
  ref: string;
  title: string;
  deadline: string;
  deadlineKind: string;
}

export interface GroupSummary {
  slug: string;
  name: string;
  district: string;
  description: string;
  memberCount: number;
  lastActivityAt: string;
  urgentItem: UrgentItem | null;
}

export interface NearbyGroup extends GroupSummary {
  distanceKm: number;
  boundary: LngLat[];
}

export interface WeeklyStats {
  pagesRead: number;
  documentsRead: number;
  /** Live stats count indexed passages instead of pages. */
  passagesRead?: number;
  itemsSurfaced: number;
  neighborhoods: number;
  windowStart: string;
  windowEnd: string;
  /** False when the most recent reading run is more than 7 days old. */
  isCurrentWeek: boolean;
  /** "sample" until the ingestion pipeline writes real reading runs. */
  source: "sample" | "live";
}

export interface GeocodedPoint {
  lat: number;
  lng: number;
  matchedAddress: string;
}

export type UnresolvedReason = "empty" | "not_found" | "outside_city" | "unavailable";

export type FindResult =
  | { status: "match"; query: string; point: GeocodedPoint; match: GroupDetail; nearby: NearbyGroup[] }
  | { status: "nearby"; query: string; point: GeocodedPoint; nearby: NearbyGroup[] }
  | { status: "none"; query: string; point: GeocodedPoint }
  | { status: "unresolved"; query: string; reason: UnresolvedReason };
